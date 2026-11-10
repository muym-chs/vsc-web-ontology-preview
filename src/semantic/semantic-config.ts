export interface DomWeightConfig {
  tagWeights: Record<string, number>;
  prefixWeights: Record<string, number>;
  attributeBoosts: Array<{ attrName: string; contains: string; weight: number }>;
  drupalLongFieldKeywords: string[];
  charsPerSkeletonLine: number;
  customStopWords: string[];
}

export const DEFAULT_DOM_WEIGHT_CONFIG: DomWeightConfig = {
  // 1. Mnożniki dla standardowych i syntetycznych tagów DOM
  tagWeights: {
    'title': 5.0,
    'h1': 5.0,
    'meta': 5.0,
    'h2': 3.5,
    'h3': 3.0,
    'header': 3.0,
    'main': 3.0,
    'article': 2.5,
    'section': 2.5,
    'twig:macro': 2.8,
    'twig:macro-call': 2.8,
    'twig:trans': 2.0
  },

  // 2. Mnożniki dla prefiksów komponentów (Drupal SDC, bloki Twig, dyrektywy Angulara)
  prefixWeights: {
    'sdc:component': 3.8, // Podbicie wagi dla Single Directory Components
    'sdc:embed': 3.8,
    'sdc:slot:': 3.2,
    'twig:block:': 2.5,
    'ng:for': 1.8,
    'ng:if': 1.5
  },

  // 3. Mnożniki zależne od atrybutów (np. konkretne pola encji Drupala lub role ARIA)
  attributeBoosts: [
    { attrName: 'data-synthetic-label', contains: 'field_title', weight: 4.5 },
    { attrName: 'data-synthetic-label', contains: 'field_lead', weight: 3.5 },
    { attrName: 'role', contains: 'heading', weight: 3.5 }
  ],

  // 4. Słowa kluczowe w nazwach pól Drupala, które dodają +5 pustych linii tekstu (Skeleton Lines)
  drupalLongFieldKeywords: [
    'body', 'description', 'summary', 'text', 'content', 'bio', 'article', 'lead', 'notes'
  ],

  // 5. Średnia liczba znaków przypadająca na 1 pustą linię w bloku
  charsPerSkeletonLine: 65,

  // 6. Dodatkowe słowa pomijane w analizie TF-IDF (np. specyficzne dla domeny projektu)
  customStopWords: ['wrapper', 'container', 'inner', 'default', 'element']
};