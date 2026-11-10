import { ParsedDocumentAst, RawAstNode } from '../parsers/drupal-sdc-macro-parser';
import { DocumentOntology, OntologyNodeData, OntologyRelation } from '../webview/ontology-viewer';

// Słownik słów pomijalnych (Stop-words PL / EN + techniczne znaczniki kodu)
const STOP_WORDS = new Set([
  // EN
  'div', 'span', 'class', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'item', 'items',
  'true', 'false', 'null', 'undefined', 'return', 'function', 'const', 'let', 'var', 'import',
  // PL
  'oraz', 'albo', 'lub', 'jest', 'dla', 'oraz', 'także', 'jako', 'przez', 'pod', 'nad',
  // Drupal / Twig / Angular techniczne
  'content', 'node', 'attributes', 'field', 'block', 'trans', 'attach', 'library', 'macro', 'self'
]);

export class SemanticMetricsEngine {
  /**
   * Przekształca surowe drzewo AST w kompletny model ontologii DocumentOntology gotowy dla Webview
   */
  public static process(parsedAst: ParsedDocumentAst): DocumentOntology {
    const allNodesFlat: RawAstNode[] = [];
    this.flattenNodes(parsedAst.rootNodes, allNodesFlat);

    // 1. Zbieranie wszystkich słów w dokumencie do obliczenia IDF oraz globalnych statystík
    const documentTermFrequency = new Map<string, number>();
    const nodeTermFrequencies = new Map<string, Map<string, number>>();
    const nodeTokenListMap = new Map<string, string[]>();

    for (const node of allNodesFlat) {
      const tokens: string[] = [];
      for (const segment of node.rawTextSegments) {
        const cleanedTokens = segment
          .toLowerCase()
          .replace(/[^\w\sąćęłńóśźż]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && isNaN(Number(t)));

        tokens.push(...cleanedTokens);
      }

      nodeTokenListMap.set(node.id, tokens);

      const localTf = new Map<string, number>();
      for (const token of tokens) {
        localTf.set(token, (localTf.get(token) || 0) + 1);
        documentTermFrequency.set(token, (documentTermFrequency.get(token) || 0) + 1);
      }
      nodeTermFrequencies.set(node.id, localTf);
    }

    // 2. Obliczenie globalnych statystyk słownych dla całego dokumentu
    let globalMostFrequentWord: { word: string; count: number } | null = null;
    let maxGlobalCount = 0;
    for (const [word, count] of documentTermFrequency.entries()) {
      if (count > maxGlobalCount) {
        maxGlobalCount = count;
        globalMostFrequentWord = { word, count };
      }
    }

    let globalMostSignificantWord: { word: string; score: number } | null = null;
    let maxGlobalScore = 0;

    // 3. Transformacja węzłów surowych na OntologyNodeData z wyliczeniem linii i TF-IDF * DOM Boost
    const totalNodesCount = allNodesFlat.length || 1;
    const rootNodesMapped = parsedAst.rootNodes.map((rn) =>
      this.mapNodeRecursive(rn, nodeTermFrequencies, documentTermFrequency, totalNodesCount, (sig) => {
        if (sig.score > maxGlobalScore) {
          maxGlobalScore = sig.score;
          globalMostSignificantWord = { word: sig.word, score: sig.score };
        }
      })
    );

    // 4. Automatyczne generowanie relacji semantic-similarity pomiędzy blokami dzielącymi kluczowe słowa
    const semanticRelations: OntologyRelation[] = [...parsedAst.relations];
    const nodeSignificantMap = new Map<string, string>(); // nodeId -> mostSignificantWord
    this.collectSignificantWords(rootNodesMapped, nodeSignificantMap);

    const nodeIds = Array.from(nodeSignificantMap.keys());
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const idA = nodeIds[i];
        const idB = nodeIds[j];
        const wordA = nodeSignificantMap.get(idA);
        const wordB = nodeSignificantMap.get(idB);

        if (wordA && wordB && wordA === wordB) {
          // Zapobieganie dublowaniu relacji parent-child
          const alreadyRelated = semanticRelations.some(
            (r) => (r.fromId === idA && r.toId === idB) || (r.fromId === idB && r.toId === idA)
          );
          if (!alreadyRelated) {
            semanticRelations.push({
              fromId: idA,
              toId: idB,
              type: 'semantic-similarity',
              label: `shared: "${wordA}"`
            });
          }
        }
      }
    }

    return {
      fileName: parsedAst.fileName,
      globalMetrics: {
        totalBlocks: allNodesFlat.length,
        globalMostFrequent: globalMostFrequentWord,
        globalMostSignificant: globalMostSignificantWord
      },
      rootNodes: rootNodesMapped,
      relations: semanticRelations
    };
  }

  private static flattenNodes(nodes: RawAstNode[], acc: RawAstNode[]): void {
    for (const node of nodes) {
      acc.push(node);
      if (node.children && node.children.length > 0) {
        this.flattenNodes(node.children, acc);
      }
    }
  }

  private static resolveDynamicNodeBoost(node: RawAstNode, weights?: LiveSemanticWeights): number {
  if (!weights) return node.domBoostWeight;

  const tag = node.tagOrComponent.toLowerCase();
  if (tag === 'h1' || tag === 'title' || tag === 'meta') {
    return weights.h1Weight;
  }
  if (tag.startsWith('sdc:component') || tag.startsWith('sdc:embed')) {
    return weights.sdcWeight;
  }
  if (tag.startsWith('twig:macro') || tag.startsWith('twig:call')) {
    return weights.twigMacroWeight;
  }
  return node.domBoostWeight;
}
  
  private static mapNodeRecursive(
    node: RawAstNode,
    nodeTermFreqs: Map<string, Map<string, number>>,
    docTermFreq: Map<string, number>,
    totalDocs: number,
    onGlobalSignificant: (sig: { word: string; score: number }) => void
  ): OntologyNodeData {
    const localTfMap = nodeTermFreqs.get(node.id) || new Map<string, number>();
    
    const effectiveBoostWeight = this.resolveDynamicNodeBoost(node);
    let maxSigScore = 0;
    let mostSig = {word: "", score: 0};
    for (const [word, tf] of localTfMap.entries()) {
      const docFreq = docTermFreq.get(word) || 1;
      const idf = Math.log(totalDocs / docFreq + 1) + 1;
      const score = tf * effectiveBoostWeight * idf;
      if (score > maxSigScore) {
        maxSigScore = score;
        mostSig = { word, score };
      }
    }

    // Dynamiczny kalkulator pustych linii tekstu sterowany suwakiem (20 - 140 znaków)
    const charsThreshold = Math.max(15, 65);
    // const charsThreshold = Math.max(15, liveWeights?.charsPerLine || 65);
    let estimatedLines = 0;
    const staticCharsCount = node.rawTextSegments.join(' ').length;
    if (staticCharsCount > 0) {
      estimatedLines = Math.ceil(staticCharsCount / charsThreshold);
    } else if (node.isDynamicContent) {
      estimatedLines = 1;
    }

    // A. Wyznaczenie Most Frequent Word dla węzła
    let mostFreq: { word: string; count: number } | null = null;
    let maxFreqCount = 0;
    for (const [word, count] of localTfMap.entries()) {
      if (count > maxFreqCount) {
        maxFreqCount = count;
        mostFreq = { word, count };
      }
    }

    // B. Wyznaczenie Most Significant Word (TF-IDF * DOM Boost Weight)
    maxSigScore=0;
    for (const [word, tf] of localTfMap.entries()) {
      const docFreq = docTermFreq.get(word) || 1;
      const idf = Math.log(totalDocs / docFreq + 1) + 1;
      const score = tf * node.domBoostWeight * idf;

      if (score > maxSigScore) {
        maxSigScore = score;
        mostSig = { word, score };
      }
    }

    if (mostSig) {
      onGlobalSignificant(mostSig);
    }

    // Uwzględnienie boostingu dla długich pól encji Drupala (np. field_body = +5 linii)
    if (node.attributes['data-estimated-lines-boost']) {
      estimatedLines += Number(node.attributes['data-estimated-lines-boost']);
    }

    const mappedChildren = node.children.map((child) =>
      this.mapNodeRecursive(child, nodeTermFreqs, docTermFreq, totalDocs, onGlobalSignificant)
    );

    return {
      id: node.id,
      tagOrComponent: node.tagOrComponent,
      frameworkOrigin: node.frameworkOrigin,
      layoutType: node.layoutType,
      cssFrameworkHints: node.cssFrameworkHints,
      metrics: {
        estimatedTextLines: Math.min(estimatedLines, 20), // Górny limit zapobiegający rozjeżdżaniu UI
        isDynamicContent: node.isDynamicContent,
        mostFrequentWord: mostFreq,
        mostSignificantWord: mostSig ? { word: mostSig.word, score: mostSig.score } : null
      },
      children: mappedChildren
    };
  }

  private static collectSignificantWords(nodes: OntologyNodeData[], map: Map<string, string>): void {
    for (const node of nodes) {
      if (node.metrics.mostSignificantWord) {
        map.set(node.id, node.metrics.mostSignificantWord.word);
      }
      if (node.children && node.children.length > 0) {
        this.collectSignificantWords(node.children, map);
      }
    }
  }
}