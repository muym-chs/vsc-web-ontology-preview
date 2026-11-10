import { OntologyRelation } from '../webview/ontology-viewer';

export interface RawAstNode {
  id: string;
  tagOrComponent: string;
  frameworkOrigin: 'html' | 'twig' | 'react' | 'angular';
  layoutType: 'block' | 'flex' | 'grid' | 'inline';
  cssFrameworkHints: string[];
  rawTextSegments: string[]; // Czysty tekst do analizy linii i TF-IDF w Etapie 2
  domBoostWeight: number;    // Mnożnik wagi wynikający z roli tagu (np. h1 = 5.0, p = 1.0)
  isDynamicContent: boolean; // Czy zawiera {{ twig }}, {jsx} lub *ngFor
  attributes: Record<string, string>;
  sourceLine?: number;       // Do skoku kursorem w edytorze VS Code
  children: RawAstNode[];
}

export interface ParsedDocumentAst {
  fileName: string;
  metadata: Record<string, string>;
  rootNodes: RawAstNode[];
  relations: OntologyRelation[];
}

export interface CustomCssRule {
  name: string;
  pattern: RegExp;
  targetLayout: 'grid' | 'flex' | 'block' | 'inline';
}

/**
 * Heurystyczny klasyfikator frameworków CSS (Tailwind, Bootstrap, BEM, natywne tagi HTML5)
 */
export class CssFrameworkClassifier {
  private static FLEX_PATTERNS = /^(d-flex|flex|inline-flex|flex-row|flex-col|justify-|items-)/;
  private static GRID_PATTERNS = /^(grid|d-grid|row|col-|grid-cols-|gap-)/;
  private static INLINE_TAGS = new Set(['span', 'a', 'strong', 'em', 'label', 'i', 'b', 'small', 'code']);

  public static classify(tagName: string, classAttr: string = ''): {
    layoutType: 'block' | 'flex' | 'grid' | 'inline';
    hints: string[];
  } {
    const classes = classAttr.split(/\s+/).filter(Boolean);
    const hints: string[] = [];
    let layoutType: 'block' | 'flex' | 'grid' | 'inline' = this.INLINE_TAGS.has(tagName.toLowerCase())
      ? 'inline'
      : 'block';

    for (const cls of classes) {
      if (this.GRID_PATTERNS.test(cls)) {
        layoutType = 'grid';
        hints.push(cls);
      } else if (this.FLEX_PATTERNS.test(cls)) {
        if (layoutType !== 'grid') layoutType = 'flex';
        hints.push(cls);
      } else if (/^(container|max-w-|w-|p-|m-|card|panel|wrapper|section)/.test(cls)) {
        hints.push(cls);
      }
    }

    return { layoutType, hints: hints.slice(0, 4) }; // Maksymalnie 4 najważniejsze podpowiedzi CSS w nagłówku

/*
for (const cls of classes) {
      let matchedLayout = false;

      for (const rule of this.layoutRules) {
        if (rule.pattern.test(cls)) {
          // Priorytetyzacja: 'grid' ma pierwszeństwo nad 'flex' i 'block'
          if (layoutType !== 'grid') {
            layoutType = rule.targetLayout;
          }
          hints.push(cls);
          matchedLayout = true;
          break;
        }
      }

      if (!matchedLayout && this.hintPatterns.some((p) => p.test(cls))) {
        hints.push(cls);
      }
    }

    return { layoutType, hints: Array.from(new Set(hints)).slice(0, 4) };
*/
  }

  public static getDomBoostWeight(tagName: string): number {
    const tag = tagName.toLowerCase();
    if (tag === 'title' || tag === 'h1' || tag === 'meta') return 5.0;
    if (tag === 'h2' || tag === 'h3' || tag === 'header' || tag === 'main') return 3.0;
    if (tag === 'article' || tag === 'section' || /^[A-Z]/.test(tagName) || tag.startsWith('twig:')) return 2.5;
    return 1.0;
  }
}