export interface CustomCssRule {
  name: string;
  pattern: RegExp;
  targetLayout: 'grid' | 'flex' | 'block' | 'inline';
}

export class CssFrameworkClassifier {
  // 1. Rejestr wzorców układu przestrzennego (łatwy do rozszerzenia)
  private static layoutRules: CustomCssRule[] = [
    // Tailwind & Bootstrap Grid
    { name: 'standard-grid', pattern: /^(grid|d-grid|row|col-|grid-cols-|gap-)/, targetLayout: 'grid' },
    // UIkit, Bulma & Drupal Layout Builder Grid
    { name: 'uikit-bulma-drupal-grid', pattern: /^(uk-grid|uk-child-width-|columns|column|layout--[a-z]+col)/, targetLayout: 'grid' },
    // Własne konwencje BEM / Utility
    { name: 'bem-grid', pattern: /^(l-grid|o-grid|c-grid)/, targetLayout: 'grid' },

    // Tailwind & Bootstrap Flex
    { name: 'standard-flex', pattern: /^(d-flex|flex|inline-flex|flex-row|flex-col|justify-|items-)/, targetLayout: 'flex' },
    // UIkit & Bulma Flex
    { name: 'uikit-bulma-flex', pattern: /^(uk-flex|is-flex|is-justify-content-|is-align-items-)/, targetLayout: 'flex' },
    // Własne konwencje BEM Flex
    { name: 'bem-flex', pattern: /^(l-flex|u-flex)/, targetLayout: 'flex' }
  ];

  // 2. Wzorce klas pomocniczych (wyświetlanych jako szare podpowiedzi .hint w nagłówku bloku)
  private static hintPatterns: RegExp[] = [
    /^(container|max-w-|w-|p-|m-|card|panel|wrapper|section)/,
    /^(uk-card|uk-container|box|hero|node--type-|paragraph--type-)/ // Dodane klasy Drupala i UIkit
  ];

  private static INLINE_TAGS = new Set(['span', 'a', 'strong', 'em', 'label', 'i', 'b', 'small', 'code']);

  /**
   * Metoda pozwalająca dynamicznie zarejestrować własną regułę CSS (np. z poziomu konfiguracji VS Code)
   */
  public static registerCustomRule(rule: CustomCssRule): void {
    this.layoutRules.unshift(rule); // Nowe reguły mają najwyższy priorytet
  }

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
  }
}