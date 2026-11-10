import * as babelParser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { CssFrameworkClassifier, ParsedDocumentAst, RawAstNode } from './types-and-css';
import { OntologyRelation } from '../webview/ontology-viewer';

export class ReactJsxParser {
  private nodeCounter = 0;

  public parse(sourceCode: string, fileName: string): ParsedDocumentAst {
    this.nodeCounter = 0;
    const rootNodes: RawAstNode[] = [];
    const relations: OntologyRelation[] = [];
    const metadata: Record<string, string> = {};

    const ast = babelParser.parse(sourceCode, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'decorators-legacy']
    });

    const nodeMap = new WeakMap<t.JSXElement, RawAstNode>();

    traverse(ast, {
      JSXElement: {
        enter: (path: NodePath<t.JSXElement>) => {
          const opening = path.node.openingElement;
          const tagName = this.getJsxTagName(opening.name);
          const id = `jsx-node-${++this.nodeCounter}`;

          const { classAttr, propsExtracted, hasDynamicProps } = this.extractJsxAttributes(opening.attributes);
          const { layoutType, hints } = CssFrameworkClassifier.classify(tagName, classAttr);

          const isCustomComponent = /^[A-Z]/.test(tagName);

          const rawNode: RawAstNode = {
            id,
            tagOrComponent: tagName,
            frameworkOrigin: isCustomComponent ? 'react' : 'html',
            layoutType,
            cssFrameworkHints: hints,
            rawTextSegments: [],
            domBoostWeight: CssFrameworkClassifier.getDomBoostWeight(tagName),
            isDynamicContent: hasDynamicProps,
            attributes: propsExtracted,
            sourceLine: opening.loc?.start.line,
            children: []
          };

          // Rozbicie nazwy komponentu PascalCase na słowa do analizy semantycznej (np. UserOrderSummary -> user order summary)
          if (isCustomComponent) {
            const wordsFromComponentName = tagName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
            rawNode.rawTextSegments.push(wordsFromComponentName);
          }

          // Ekstrakcja bezpośredniego tekstu i wyrażeń {expression} wewnątrz tagu JSX
          for (const child of path.node.children) {
            if (t.isJSXText(child)) {
              const cleaned = child.value.trim();
              if (cleaned) rawNode.rawTextSegments.push(cleaned);
            } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
              rawNode.isDynamicContent = true;
              const exprIdentifier = this.extractIdentifierName(child.expression);
              if (exprIdentifier) {
                rawNode.rawTextSegments.push(exprIdentifier);
              }
            }
          }

          nodeMap.set(path.node, rawNode);

          // Budowanie hierarchii rodzic-dziecko w drzewie JSX
          const parentJsx = path.findParent((p) => p.isJSXElement()) as NodePath<t.JSXElement> | null;
          if (parentJsx && nodeMap.has(parentJsx.node)) {
            const parentRaw = nodeMap.get(parentJsx.node)!;
            parentRaw.children.push(rawNode);

            // Jeśli przekazywane są propsy do komponentu potomnego, dodajemy relację w ontologii
            const boundPropNames = Object.keys(propsExtracted).filter((k) => k !== 'className' && k !== 'style');
            if (isCustomComponent && boundPropNames.length > 0) {
              relations.push({
                fromId: parentRaw.id,
                toId: rawNode.id,
                type: 'prop-binding',
                label: `props: ${boundPropNames.slice(0, 2).join(', ')}`
              });
            }
          } else {
            rootNodes.push(rawNode);
          }
        }
      }
    });

    return { fileName, metadata, rootNodes, relations };
  }

  private getJsxTagName(nameNode: t.JSXOpeningElement['name']): string {
    if (t.isJSXIdentifier(nameNode)) return nameNode.name;
    if (t.isJSXMemberExpression(nameNode)) {
      return `${this.getJsxTagName(nameNode.object)}.${nameNode.property.name}`;
    }
    return 'Fragment';
  }

  private extractJsxAttributes(attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute>): {
    classAttr: string;
    propsExtracted: Record<string, string>;
    hasDynamicProps: boolean;
  } {
    let classAttr = '';
    let hasDynamicProps = false;
    const propsExtracted: Record<string, string> = {};

    for (const attr of attributes) {
      if (t.isJSXSpreadAttribute(attr)) {
        hasDynamicProps = true;
        continue;
      }
      const propName = t.isJSXIdentifier(attr.name) ? attr.name.name : 'unknown';
      if (t.isStringLiteral(attr.value)) {
        propsExtracted[propName] = attr.value.value;
        if (propName === 'className' || propName === 'class') {
          classAttr = attr.value.value;
        }
      } else if (t.isJSXExpressionContainer(attr.value)) {
        hasDynamicProps = true;
        propsExtracted[propName] = '{dynamic}';
      }
    }

    return { classAttr, propsExtracted, hasDynamicProps };
  }

  private extractIdentifierName(expr: t.Expression): string | null {
    if (t.isIdentifier(expr)) return expr.name;
    if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
      return expr.property.name;
    }
    return null;
  }
}