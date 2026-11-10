import * as htmlparser2 from 'htmlparser2';
import { CssFrameworkClassifier, ParsedDocumentAst, RawAstNode } from './types-and-css';
import { OntologyRelation } from '../webview/ontology-viewer';

export interface SdcYamlSchemaMetadata {
  name?: string;
  status?: string;
  description?: string;
  props?: Record<string, { title?: string; type?: string }>;
  slots?: Record<string, { title?: string; description?: string }>;
}

export interface DrupalFieldHint {
  rawExpression: string;
  fieldNameClean: string;
  estimatedLinesBoost: number;
}

export class EnhancedTwigAndAngularParser {
  private nodeCounter = 0;

  /**
   * Główna metoda parsująca plik Twig / HTML / Angular z opcjonalnym wsparciem dla pliku *.component.yml (Drupal SDC)
   */
  public parse(
    sourceCode: string,
    fileName: string,
    sdcYamlSchema?: SdcYamlSchemaMetadata
  ): ParsedDocumentAst {
    this.nodeCounter = 0;
    const isTwig = fileName.endsWith('.twig');
    const isAngular =
      fileName.endsWith('.html') &&
      (sourceCode.includes('@for') || sourceCode.includes('@if') || sourceCode.includes('*ng'));

    const relations: OntologyRelation[] = [];
    const metadata: Record<string, string> = {};
    const attachedLibraries: string[] = [];

    // Mapa zdefiniowanych makr w bieżącym pliku: nazwa_makra -> ID węzła AST
    const definedMacrosMap = new Map<string, string>();
    // Mapa zaimportowanych przestrzeni nazw makr: alias -> ścieżka pliku ({% import 'macros.twig' as ui %})
    const macroImportsMap = new Map<string, string>();

    // 0. Jeśli przekazano schemat Drupal SDC (*.component.yml), rejestrujemy jego metadane
    if (sdcYamlSchema) {
      if (sdcYamlSchema.name) metadata['sdcComponentName'] = sdcYamlSchema.name;
      if (sdcYamlSchema.description) metadata['sdcDescription'] = sdcYamlSchema.description;
      if (sdcYamlSchema.props) {
        metadata['sdcDeclaredProps'] = Object.keys(sdcYamlSchema.props).join(', ');
      }
      if (sdcYamlSchema.slots) {
        metadata['sdcDeclaredSlots'] = Object.keys(sdcYamlSchema.slots).join(', ');
      }
    }

    // 1. Wyciągnięcie definicji tablic klas z Twig: {% set classes = ['node', 'flex'] %}
    const twigClassVars = isTwig ? this.extractTwigSetClassArrays(sourceCode) : new Map<string, string[]>();

    // 2. Ekstrakcja attach_library('module/library_name') oraz {% import '...' as alias %}
    if (isTwig) {
      for (const match of sourceCode.matchAll(/attach_library\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        attachedLibraries.push(match[1]);
      }
      if (attachedLibraries.length > 0) {
        metadata['drupalLibraries'] = attachedLibraries.join(', ');
      }

      for (const impMatch of sourceCode.matchAll(/\{%\s*import\s+['"]([^'"]+)['"]\s+as\s+([a-zA-Z0-9_]+)\s*%\}/g)) {
        macroImportsMap.set(impMatch[2], impMatch[1]);
      }
      if (macroImportsMap.size > 0) {
        metadata['twigMacroImports'] = Array.from(macroImportsMap.entries())
          .map(([alias, path]) => `${alias} -> ${path}`)
          .join(', ');
      }
    }

    // 3. Transformacja składni blokowej (Drupal Twig + SDC + Macros lub Angular 17+ @for/@if) na syntetyczne tagi DOM
    let preprocessed = sourceCode;
    if (isTwig) {
      preprocessed = this.preprocessDrupalTwigSdcAndMacros(preprocessed, twigClassVars, macroImportsMap);
    }
    if (isAngular) {
      preprocessed = this.transformAngularControlFlow(preprocessed);
    }

    const rootNodes: RawAstNode[] = [];
    const stack: RawAstNode[] = [];
    // Lista wywołań makr do spięcia krawędziami po zakończeniu parsowania drzewa
    const pendingMacroCalls: Array<{ callerNodeId: string; macroName: string; namespace: string; args: string }> = [];

    const parser = new htmlparser2.Parser(
      {
        onopentag: (name, attribs) => {
          if (name === 'meta' && attribs.name && attribs.content) {
            metadata[attribs.name] = attribs.content;
          }

          const id = `node-${++this.nodeCounter}`;

          const combinedClasses = [
            attribs.class || '',
            attribs.className || '',
            attribs['data-drupal-classes'] || ''
          ]
            .join(' ')
            .trim();

          const { layoutType, hints } = CssFrameworkClassifier.classify(name, combinedClasses);

          const hasAngularBindings = Object.keys(attribs).some(
            (k) => k.startsWith('*ng') || k.startsWith('[') || k.startsWith('(') || name.startsWith('ng:')
          );

          const origin: RawAstNode['frameworkOrigin'] =
            name.startsWith('twig:') || name.startsWith('sdc:') || isTwig
              ? 'twig'
              : isAngular || hasAngularBindings
              ? 'angular'
              : 'html';

          // Sprawdź, czy jesteśmy wewnątrz komponentu {% embed 'provider:component' %} -> wtedy {% block %} staje się slotem SDC
          const parentNode = stack.length > 0 ? stack[stack.length - 1] : null;
          const isInsideSdcEmbed = stack.some((n) => n.tagOrComponent.startsWith('sdc:embed'));

          let resolvedLabel = attribs['data-synthetic-label'] || name;
          if (name === 'twig:block' && isInsideSdcEmbed && attribs['data-block-name']) {
            resolvedLabel = `sdc:slot:${attribs['data-block-name']}`;
          }

          const node: RawAstNode = {
            id,
            tagOrComponent: resolvedLabel,
            frameworkOrigin: origin,
            layoutType,
            cssFrameworkHints: hints,
            rawTextSegments: [],
            domBoostWeight: this.resolveBoostWeight(name, resolvedLabel, attribs),
            isDynamicContent:
              hasAngularBindings || name.startsWith('twig:') || name.startsWith('sdc:') || name.startsWith('ng:'),
            attributes: attribs,
            children: []
          };

          // Rejestracja definicji {% macro name(...) %} w mapie pliku
          if (name === 'twig:macro' && attribs['data-macro-name']) {
            definedMacrosMap.set(attribs['data-macro-name'], id);
          }

          // Rejestracja wywołania makra (np. <twig:macro-call>)
          if (name === 'twig:macro-call' && attribs['data-macro-target']) {
            pendingMacroCalls.push({
              callerNodeId: id,
              namespace: attribs['data-macro-ns'] || '_self',
              macroName: attribs['data-macro-target'],
              args: attribs['data-macro-args'] || ''
            });
          }

          if (attribs.alt) node.rawTextSegments.push(attribs.alt);
          if (attribs['aria-label']) node.rawTextSegments.push(attribs['aria-label']);
          if (attribs['data-semantic-tokens']) {
            node.rawTextSegments.push(attribs['data-semantic-tokens']);
          }

          // Relacje dla klasycznych {% include %}, komponentów SDC oraz slotów SDC
          if (attribs['data-twig-dependency'] && parentNode) {
            const isSdcPropBinding = attribs['data-sdc-props'];
            relations.push({
              fromId: parentNode.id,
              toId: id,
              type: isSdcPropBinding ? 'prop-binding' : 'twig-include',
              label: isSdcPropBinding
                ? `${attribs['data-twig-dependency']} [props: ${isSdcPropBinding}]`
                : attribs['data-twig-dependency']
            });
          } else if (resolvedLabel.startsWith('sdc:slot:') && parentNode) {
            relations.push({
              fromId: parentNode.id,
              toId: id,
              type: 'prop-binding',
              label: `slot: ${attribs['data-block-name']}`
            });
          }

          if (parentNode) {
            parentNode.children.push(node);
          } else {
            rootNodes.push(node);
          }

          stack.push(node);
        },

        ontext: (text) => {
          const trimmed = text.trim();
          if (!trimmed || stack.length === 0) return;

          const current = stack[stack.length - 1];

          // A. Tłumaczenia Drupal Twig: {{ 'Tekst'|t }} lub {{ "Tekst"|trans }}
          const translatedLiterals = Array.from(
            trimmed.matchAll(/\{\{\s*['"]([^'"]+)['"]\s*\|\s*(?:t|trans)\b[^}]*\}\}/g)
          ).map((m) => m[1]);
          if (translatedLiterals.length > 0) {
            current.rawTextSegments.push(...translatedLiterals);
          }

          // B. Pola encji Drupala: {{ content.field_* }}, {{ node.field_* }}
          const drupalFields = this.extractDrupalEntityFields(trimmed);
          if (drupalFields.length > 0) {
            current.isDynamicContent = true;
            for (const field of drupalFields) {
              current.rawTextSegments.push(field.fieldNameClean);
              if (field.estimatedLinesBoost > 1) {
                current.attributes['data-estimated-lines-boost'] = String(field.estimatedLinesBoost);
              }
            }
          }

          // C. Pozostałe interpolacje {{ var }}
          if (/\{\{[\s\S]*?\}\}/.test(trimmed)) {
            current.isDynamicContent = true;
            const genericVars = Array.from(trimmed.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g))
              .map((m) => m[1])
              .filter((v) => !v.startsWith('attach_library') && !v.includes('field_') && !v.startsWith('_self.'));

            for (const v of genericVars) {
              current.rawTextSegments.push(v.replace(/[._]/g, ' '));
            }
          }

          // D. Czysty tekst statyczny
          const cleanStatic = trimmed.replace(/\{\{[\s\S]*?\}\}/g, ' ').trim();
          if (cleanStatic) {
            current.rawTextSegments.push(cleanStatic);
            if (current.tagOrComponent === 'title') {
              metadata['title'] = cleanStatic;
            }
          }
        },

        onclosetag: () => {
          stack.pop();
        }
      },
      { decodeEntities: true, lowerCaseTags: false, recognizeSelfClosing: true }
    );

    parser.write(preprocessed);
    parser.end();

    // 4. Rozwiązanie referencji wywołań makr -> dodanie krawędzi w grafie ontologii
    for (const call of pendingMacroCalls) {
      if (call.namespace === '_self' && definedMacrosMap.has(call.macroName)) {
        const targetMacroNodeId = definedMacrosMap.get(call.macroName)!;
        relations.push({
          fromId: call.callerNodeId,
          toId: targetMacroNodeId,
          type: 'prop-binding',
          label: `macro: _self.${call.macroName}(${call.args})`
        });
      }
    }

    // 5. Jeśli dostarczono schemat *.component.yml (SDC) i w drzewie są główne bloki, wzbogacamy pierwszy węzeł główny o opis SDC
    if (sdcYamlSchema && rootNodes.length > 0) {
      const primaryRoot = rootNodes[0];
      if (sdcYamlSchema.props) {
        primaryRoot.rawTextSegments.push(...Object.keys(sdcYamlSchema.props));
      }
      if (sdcYamlSchema.slots) {
        primaryRoot.rawTextSegments.push(...Object.keys(sdcYamlSchema.slots));
      }
    }

    return { fileName, metadata, rootNodes, relations };
  }

  /**
   * Przetwarza konstrukcje Drupal Twig, Single Directory Components (SDC) oraz Twig Macros
   */
  private preprocessDrupalTwigSdcAndMacros(
    code: string,
    classVars: Map<string, string[]>,
    macroImportsMap: Map<string, string>
  ): string {
    const importedAliases = new Set(['_self', ...macroImportsMap.keys()]);

    return (
      code
        // 1. Drupal attributes.addClass(...)
        .replace(
          /\{\{\s*([a-zA-Z0-9_]*attributes)\.addClass\(([^)]*)\)[^}]*\}\}/g,
          (_, _attrObj, argsStr: string) => {
            const extractedClasses: string[] = [];
            for (const strMatch of argsStr.matchAll(/['"]([^'"]+)['"]/g)) {
              extractedClasses.push(strMatch[1]);
            }
            for (const idMatch of argsStr.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
              const varName = idMatch[1];
              if (classVars.has(varName)) {
                extractedClasses.push(...classVars.get(varName)!);
              }
            }
            return ` data-drupal-classes="${extractedClasses.join(' ')}"`;
          }
        )
        .replace(
          /<([a-zA-Z0-9-]+)([^>]*?)\{\{\s*attributes[^}]*\}\}([^>]*?)>/g,
          '<$1$2 data-drupal-attrs="true"$3>'
        )

        // 2. Deklaracje Twig Macro: {% macro button(label, type, icon) %} ... {% endmacro %}
        .replace(
          /\{%\s*macro\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*%\}/g,
          (_, macroName: string, argsStr: string) => {
            const cleanArgs = argsStr.replace(/['"=]/g, ' ').trim();
            return `<twig:macro data-synthetic-label="twig:macro:${macroName}(${argsStr.trim()})" data-macro-name="${macroName}" data-semantic-tokens="${macroName} ${cleanArgs}">`;
          }
        )
        .replace(/\{%\s*endmacro(?:\s+[a-zA-Z0-9_]+)?\s*%\}/g, '</twig:macro>')

        // 3. Wywołania Twig Macro: {{ _self.button('Zapisz', 'primary') }} lub {{ ui.card(node.title) }}
        .replace(
          /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\(([^)]*)\)\s*\}\}/g,
          (fullMatch, ns: string, fnName: string, argsStr: string) => {
            // Sprawdzamy, czy to wywołanie zaimportowanego makra lub _self (a nie np. attributes.addClass)
            if (!importedAliases.has(ns) || ns === 'attributes' || ns === 'content' || ns === 'node') {
              return fullMatch;
            }
            const cleanArgs = argsStr.replace(/['"{}]/g, '').trim();
            const sourceHint = ns === '_self' ? '_self' : `${ns} (${macroImportsMap.get(ns)})`;
            return `<twig:macro-call data-synthetic-label="twig:call ${ns}.${fnName}()" data-macro-ns="${ns}" data-macro-target="${fnName}" data-macro-args="${cleanArgs}" data-twig-dependency="macro: ${sourceHint}.${fnName}" data-semantic-tokens="${fnName} ${cleanArgs}" />`;
          }
        )

        // 4. Drupal SDC & Twig {% embed 'provider:component' with { prop1: val } %} ... {% endembed %}
        .replace(
          /\{%\s*embed\s+['"]([^'"]+)['"](?:\s+with\s+\{([\s\S]*?)\})?[^%]*%\}/g,
          (_, target: string, withBody?: string) => {
            const isSdc = target.includes(':') && !target.startsWith('@');
            const tagPrefix = isSdc ? 'sdc:embed' : 'twig:embed';
            const propsKeys = withBody ? this.extractTwigWithObjectKeys(withBody) : [];
            const propsAttr = propsKeys.length > 0 ? ` data-sdc-props="${propsKeys.join(', ')}"` : '';
            const semanticTokens = `${target.replace(/[:/_.-]/g, ' ')} ${propsKeys.join(' ')}`.trim();

            return `<${tagPrefix} data-synthetic-label="${tagPrefix} (${target})" data-twig-dependency="${tagPrefix}: ${target}"${propsAttr} data-semantic-tokens="${semanticTokens}">`;
          }
        )
        .replace(/\{%\s*endembed\s*%\}/g, '</sdc:embed>')

        // 5. Drupal SDC & Twig {% include 'provider:component' with { prop1: val } %}
        .replace(
          /\{%\s*include\s+['"]([^'"]+)['"](?:\s+with\s+\{([\s\S]*?)\})?[^%]*%\}/g,
          (_, target: string, withBody?: string) => {
            const isSdc = target.includes(':') && !target.startsWith('@');
            const tagPrefix = isSdc ? 'sdc:component' : 'twig:include';
            const propsKeys = withBody ? this.extractTwigWithObjectKeys(withBody) : [];
            const propsAttr = propsKeys.length > 0 ? ` data-sdc-props="${propsKeys.join(', ')}"` : '';
            const semanticTokens = `${target.replace(/[:/_.-]/g, ' ')} ${propsKeys.join(' ')}`.trim();

            return `<${tagPrefix} data-synthetic-label="${tagPrefix} (${target})" data-twig-dependency="${tagPrefix}: ${target}"${propsAttr} data-semantic-tokens="${semanticTokens}" />`;
          }
        )

        // 6. Bloki {% block name %} (wewnątrz sdc:embed zostaną automatycznie zamienione na sdc:slot:name)
        .replace(
          /\{%\s*block\s+([a-zA-Z0-9_]+)\s*%\}/g,
          '<twig:block data-synthetic-label="twig:block:$1" data-block-name="$1" data-semantic-tokens="$1">'
        )
        .replace(/\{%\s*endblock(?:\s+[a-zA-Z0-9_]+)?\s*%\}/g, '</twig:block>')

        // 7. Bloki tłumaczeń {% trans %} oraz pętle {% for %}
        .replace(/\{%\s*trans\s*%\}/g, '<twig:trans data-synthetic-label="twig:trans">')
        .replace(/\{%\s*endtrans\s*%\}/g, '</twig:trans>')
        .replace(
          /\{%\s*for\s+([a-zA-Z0-9_,\s]+)\s+in\s+([a-zA-Z0-9_.]+)\s*%\}/g,
          '<twig:for data-synthetic-label="twig:for ($2)" data-semantic-tokens="$2">'
        )
        .replace(/\{%\s*endfor\s*%\}/g, '</twig:for>')
    );
  }

  /**
   * Wyciąga klucze przekazywanych właściwości z klauzuli Twig `with { title: node.label, variant: 'primary' }`
   */
  private extractTwigWithObjectKeys(withBody: string): string[] {
    const keys: string[] = [];
    for (const match of withBody.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) {
      keys.push(match[1]);
    }
    return keys;
  }

  private extractTwigSetClassArrays(code: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const setRegex = /\{%\s*set\s+([a-zA-Z0-9_]+)\s*=\s*\[([\s\S]*?)\]\s*%\}/g;
    for (const match of code.matchAll(setRegex)) {
      const varName = match[1];
      const literals = Array.from(match[2].matchAll(/['"]([a-zA-Z0-9_-]+)['"]/g)).map((m) => m[1]);
      if (literals.length > 0) map.set(varName, literals);
    }
    return map;
  }

  private extractDrupalEntityFields(text: string): DrupalFieldHint[] {
    const results: DrupalFieldHint[] = [];
    const fieldRegex = /\b(?:content|node|paragraph|item|entity|term|user)\.(field_[a-zA-Z0-9_]+|body|title|label)\b/g;

    for (const match of text.matchAll(fieldRegex)) {
      const rawField = match[1];
      const cleanWords = rawField.replace(/^field_/, '').replace(/_/g, ' ').trim();
      const isLongText = /(body|description|summary|text|content|bio|article)/.test(cleanWords);
      results.push({
        rawExpression: match[0],
        fieldNameClean: cleanWords,
        estimatedLinesBoost: isLongText ? 5 : 1
      });
    }
    return results;
  }

  public transformAngularControlFlow(source: string): string {
    const controlRegex = /@(if|else\s+if|else|for|empty|defer|placeholder|loading)\s*(?:\(([^)]*)\))?\s*\{/g;
    let result = '';
    let lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = controlRegex.exec(source)) !== null) {
      const directive = match[1].replace(/\s+/g, '-');
      const expr = (match[2] || '').trim();
      const openBraceIndex = match.index + match[0].length - 1;

      const closeBraceIndex = this.findMatchingClosingBrace(source, openBraceIndex);
      if (closeBraceIndex === -1) continue;

      result += source.slice(lastIndex, match.index);
      const innerContent = source.slice(openBraceIndex + 1, closeBraceIndex);
      const transformedInner = this.transformAngularControlFlow(innerContent);

      const safeExpr = expr.replace(/"/g, '&quot;');
      const semanticTokens = expr.replace(/\b(let|of|track|by|index)\b/g, ' ').replace(/[^\w\s]/g, ' ').trim();

      result += `<ng:${directive} data-synthetic-label="@${directive}${expr ? ` (${safeExpr})` : ''}" data-semantic-tokens="${semanticTokens}">${transformedInner}</ng:${directive}>`;

      lastIndex = closeBraceIndex + 1;
      controlRegex.lastIndex = lastIndex;
    }

    result += source.slice(lastIndex);
    return result;
  }

  private findMatchingClosingBrace(text: string, openPos: number): number {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = openPos; i < text.length; i++) {
      const ch = text[i];
      const prev = i > 0 ? text[i - 1] : '';

      if (ch === "'" && !inDoubleQuote && prev !== '\\') inSingleQuote = !inSingleQuote;
      else if (ch === '"' && !inSingleQuote && prev !== '\\') inDoubleQuote = !inDoubleQuote;

      if (inSingleQuote || inDoubleQuote) continue;

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private resolveBoostWeight(tagName: string, resolvedLabel: string, attribs: Record<string, string>): number {
    if (resolvedLabel.startsWith('sdc:component') || resolvedLabel.startsWith('sdc:embed')) return 3.5;
    if (resolvedLabel.startsWith('sdc:slot:')) return 3.0;
    if (tagName === 'twig:macro' || tagName === 'twig:macro-call') return 2.8;
    if (tagName === 'twig:trans') return 2.0;
    if (attribs['data-synthetic-label']?.includes('field_title')) return 4.0;
    return CssFrameworkClassifier.getDomBoostWeight(tagName);
  }
}