import { DocumentOntology, LiveSemanticWeights, OntologyNodeData } from '../webview/ontology-viewer';

export class OntologyMarkdownExporter {
  public static generateMarkdownReport(
    ontology: DocumentOntology,
    weights: LiveSemanticWeights
  ): string {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const freqGlobal = ontology.globalMetrics.globalMostFrequent
      ? `\`${ontology.globalMetrics.globalMostFrequent.word}\` (${ontology.globalMetrics.globalMostFrequent.count}x)`
      : 'Brak';
    const sigGlobal = ontology.globalMetrics.globalMostSignificant
      ? `\`${ontology.globalMetrics.globalMostSignificant.word}\` (score: ${ontology.globalMetrics.globalMostSignificant.score.toFixed(2)})`
      : 'Brak';

    const flatRows: Array<{
      id: string;
      depth: number;
      tag: string;
      origin: string;
      layout: string;
      lines: number;
      dynamic: boolean;
      freq: string;
      sig: string;
    }> = [];

    const mermaidLines: string[] = ['flowchart TD'];

    const traverse = (node: OntologyNodeData, depth: number, parentId?: string) => {
      const safeLabel = node.tagOrComponent.replace(/"/g, "'");
      const sigBadge = node.metrics.mostSignificantWord
        ? `\\n🎯 ${node.metrics.mostSignificantWord.word} (${node.metrics.mostSignificantWord.score.toFixed(1)})`
        : '';
      const linesInfo = `\\n[${node.layoutType.toUpperCase()} | ${node.metrics.estimatedTextLines} linii]`;

      const mermaidNodeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
      mermaidLines.push(`    ${mermaidNodeId}["<${safeLabel}>${linesInfo}${sigBadge}"]`);

      if (parentId) {
        const parentMermaidId = parentId.replace(/[^a-zA-Z0-9_]/g, '_');
        mermaidLines.push(`    ${parentMermaidId} --> ${mermaidNodeId}`);
      }

      flatRows.push({
        id: node.id,
        depth,
        tag: `${'— '.repeat(depth)}\`<${node.tagOrComponent}>\``,
        origin: node.frameworkOrigin.toUpperCase(),
        layout: `${node.layoutType}${node.cssFrameworkHints.length ? ` (.${node.cssFrameworkHints.join(' .')})` : ''}`,
        lines: node.metrics.estimatedTextLines,
        dynamic: node.metrics.isDynamicContent,
        freq: node.metrics.mostFrequentWord
          ? `${node.metrics.mostFrequentWord.word} (${node.metrics.mostFrequentWord.count}x)`
          : '-',
        sig: node.metrics.mostSignificantWord
          ? `**${node.metrics.mostSignificantWord.word}** (${node.metrics.mostSignificantWord.score.toFixed(1)})`
          : '-'
      });

      for (const child of node.children) {
        traverse(child, depth + 1, node.id);
      }
    };

    for (const root of ontology.rootNodes) {
      traverse(root, 0);
    }

    // Dodanie relacji nieliniowych (SDC slots, Twig Macros, React props, Semantic Similarity) do wykresu Mermaid
    for (const rel of ontology.relations) {
      if (rel.type === 'parent-child') continue;
      const fromId = rel.fromId.replace(/[^a-zA-Z0-9_]/g, '_');
      const toId = rel.toId.replace(/[^a-zA-Z0-9_]/g, '_');
      const label = (rel.label || rel.type).replace(/"/g, "'");

      if (rel.type === 'semantic-similarity') {
        mermaidLines.push(`    ${fromId} -. "${label}" .-> ${toId}`);
      } else {
        mermaidLines.push(`    ${fromId} == "${label}" ==> ${toId}`);
      }
    }

    const tableRowsMd = flatRows
      .map(
        (r) =>
          `| \`${r.id}\` | ${r.tag} | ${r.origin} | ${r.layout} | ${r.lines} ${r.dynamic ? '*(dyn)*' : ''} | ${r.freq} | ${r.sig} |`
      )
      .join('\n');

    return `# Raport Ontologii UI & Analizy Semantycznej TF-IDF

* **Plik źródłowy:** \`${ontology.fileName}\`
* **Data wygenerowania:** \`${timestamp}\`
* **Całkowita liczba komponentów blokowych:** \`${ontology.globalMetrics.totalBlocks}\`
* **🔥 Najpopularniejsze słowo (Global TF):** ${freqGlobal}
* **🎯 Główny Koncept Dokumentu (TF-IDF + DOM Boost):** ${sigGlobal}
* **Parametry wag DOM podczas eksportu:** \`h1=${weights.h1Weight}x\`, \`SDC=${weights.sdcWeight}x\`, \`Macro=${weights.twigMacroWeight}x\`, \`Próg linii=${weights.charsPerLine} zn.\`

---

## 1. Graf Ontologii Komponentów i Powiązań Semantycznych (Mermaid)

\`\`\`mermaid
${mermaidLines.join('\n')}
\`\`\`

---

## 2. Macierz Bloków, Pustych Linii Tekstu (Skeleton Lines) i Wag Słów

| ID | Komponent / Węzeł | Technologia | Układ CSS | Linie tekstu | 🔥 Top Word (TF) | 🎯 Most Significant (TF-IDF) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
${tableRowsMd}
`;
  }
}