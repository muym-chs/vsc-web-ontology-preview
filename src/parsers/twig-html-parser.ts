import * as htmlparser2 from 'htmlparser2';
import { CssFrameworkClassifier, ParsedDocumentAst, RawAstNode } from './types-and-css';
import { OntologyRelation } from '../webview/ontology-viewer';

export class TwigAndHtmlParser {
  private nodeCounter = 0;

  public parse(sourceCode: string, fileName: string): ParsedDocumentAst {
    this.nodeCounter = 0;
    const isTwig = fileName.endsWith('.twig');
    const isAngular = fileName.endsWith('.component.html');
    const relations: OntologyRelation[] = [];
    const metadata: Record<string, string> = {};

    // 1. Pre-processing tagów strukturalnych Twig na syntetyczne węzły XML/HTML
    const preprocessed = isTwig ? this.preprocessTwigTags(sourceCode) : sourceCode;

    const rootNodes: RawAstNode[] = [];
    const stack: RawAstNode[] = [];

    const parser = new htmlparser2.Parser(
      {
        onopentag: (name, attribs) => {
          // Ekstrakcja globalnych metadanych dokumentu
          if (name === 'meta' && attribs.name && attribs.content) {
            metadata[attribs.name] = attribs.content;
          }

          const id = `node-${++this.nodeCounter}`;
          const classAttr = attribs.class || attribs.className || '';
          const { layoutType, hints } = CssFrameworkClassifier.classify(name, classAttr);

          // Rozpoznawanie dyrektyw Angulara (*ngFor, *ngIf, [ngClass])
          const hasAngularDirectives = Object.keys(attribs).some(
            (k) => k.startsWith('*ng') || k.startsWith('[') || k.startsWith('(')
          );

          const origin: RawAstNode['frameworkOrigin'] = name.startsWith('twig:')
            ? 'twig'
            : isAngular || hasAngularDirectives
            ? 'angular'
            : isTwig
            ? 'twig'
            : 'html';

          const node: RawAstNode = {
            id,
            tagOrComponent: attribs['data-twig-label'] || name,
            frameworkOrigin: origin,
            layoutType,
            cssFrameworkHints: hints,
            rawTextSegments: [],
            domBoostWeight: CssFrameworkClassifier.getDomBoostWeight(name),
            isDynamicContent: hasAngularDirectives || name.startsWith('twig:'),
            attributes: attribs,
            children: []
          };

          // Dodanie tekstów z atrybutów dostępności i SEO (alt, aria-label, title)
          if (attribs.alt) node.rawTextSegments.push(attribs.alt);
          if (attribs['aria-label']) node.rawTextSegments.push(attribs['aria-label']);

          // Rejestracja relacji {% include '...' %} lub {% embed '...' %}
          if (attribs['data-twig-include'] && stack.length > 0) {
            relations.push({
              fromId: stack[stack.length - 1].id,
              toId: id,
              type: 'twig-include',
              label: `include: ${attribs['data-twig-include']}`
            });
          }

          if (stack.length > 0) {
            stack[stack.length - 1].children.push(node);
          } else {
            rootNodes.push(node);
          }

          stack.push(node);
        },

        ontext: (text) => {
          const trimmed = text.trim();
          if (!trimmed || stack.length === 0) return;

          const current = stack[stack.length - 1];

          // Wykrywanie interpolacji {{ variable }} (Twig / Angular)
          if (/\{\{[\s\S]*?\}\}/.test(trimmed)) {
            current.isDynamicContent = true;
            // Wyciągamy nazwy zmiennych jako słowa znaczące dla ontologii (np. {{ article.title }} -> article title)
            const vars = Array.from(trimmed.matchAll(/\{\{\s*([a-zA-Z0-9_$.]+)/g)).map((m) =>
              m[1].replace(/[._]/g, ' ')
            );
            current.rawTextSegments.push(...vars);
          }

          // Czysty tekst bez nawiasów klamrowych
          const cleanStaticText = trimmed.replace(/\{\{[\s\S]*?\}\}/g, ' ').trim();
          if (cleanStaticText) {
            current.rawTextSegments.push(cleanStaticText);
            if (current.tagOrComponent === 'title') {
              metadata['title'] = cleanStaticText;
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

    return { fileName, metadata, rootNodes, relations };
  }

  /**
   * Zamienia bloki Twig na syntetyczne elementy HTML, aby zachować hierarchię drzewa DOM
   */
  private preprocessTwigTags(code: string): string {
    return code
      // {% block name %} ... {% endblock %}
      .replace(/\{%\s*block\s+([a-zA-Z0-9_]+)\s*%\}/g, '<twig:block data-twig-label="twig:block:$1">')
      .replace(/\{%\s*endblock(?:\s+[a-zA-Z0-9_]+)?\s*%\}/g, '</twig:block>')
      // {% for item in items %} ... {% endfor %}
      .replace(/\{%\s*for\s+([a-zA-Z0-9_,\s]+)\s+in\s+([a-zA-Z0-9_.]+)\s*%\}/g, '<twig:for data-twig-label="twig:for ($2)">')
      .replace(/\{%\s*endfor\s*%\}/g, '</twig:for>')
      // {% include 'template.html.twig' %}
      .replace(/\{%\s*include\s+['"]([^'"]+)['"][^%]*%\}/g, '<twig:include data-twig-label="twig:include ($1)" data-twig-include="$1" />');
  }
}