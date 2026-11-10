import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EnhancedTwigAndAngularParser, SdcYamlSchemaMetadata } from '../parsers/drupal-sdc-macro-parser';
import { ReactJsxParser } from '../parsers/react-jsx-parser';
import { SemanticMetricsEngine } from '../semantic/semantic-engine';
import {
  DocumentOntology,
  LiveSemanticWeights,
  OntologyNodeData,
  OntologyRelation
} from '../webview/ontology-viewer';

interface IndexedWorkspaceFile {
  nodeId: string;
  fsPath: string;
  relativePath: string;
  fileName: string;
  cluster: 'sdc' | 'twig' | 'react' | 'angular';
  sdcId?: string; // np. 'ddna:genome-card' lub 'genome-card'
  reactOrNgSymbol?: string; // np. 'OrderSummary' lub 'app-order-summary'
  ontology: DocumentOntology;
  totalEstimatedLines: number;
  rawOutgoingTargets: Array<{
    targetKey: string;
    relationType: OntologyRelation['type'];
    label: string;
  }>;
}

export class WorkspaceOntologyScanner {
  private static parserTwigAngular = new EnhancedTwigAndAngularParser();
  private static parserReact = new ReactJsxParser();

  /**
   * Skanuje cały workspace VS Code i buduje międzyplikowy graf ontologii UI
   */
  public static async scanWorkspace(
    weights?: LiveSemanticWeights,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<DocumentOntology> {
    const includePattern = '**/*.{twig,jsx,tsx,component.html}';
    const excludePattern = '**/{node_modules,vendor,dist,build,.git,coverage}/**';

    const uris = await vscode.workspace.findFiles(includePattern, excludePattern, 500);
    const indexedFiles: IndexedWorkspaceFile[] = [];

    // Rejestry szybkiego wyszukiwania celów referencji
    const bySdcName = new Map<string, IndexedWorkspaceFile>();
    const byFileName = new Map<string, IndexedWorkspaceFile>();
    const byComponentSymbol = new Map<string, IndexedWorkspaceFile>();

    const total = uris.length || 1;
    let fileCounter = 0;

    for (const uri of uris) {
      fileCounter++;
      const fsPath = uri.fsPath;
      const fileName = path.basename(fsPath);
      const relativePath = vscode.workspace.asRelativePath(uri, false);

      progress?.report({
        message: `Analiza AST & TF-IDF (${fileCounter}/${total}): ${fileName}`,
        increment: (1 / total) * 75
      });

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const sourceCode = Buffer.from(contentBytes).toString('utf8');

      // Sprawdź czy obok pliku .twig istnieje plik *.component.yml (Drupal SDC)
      const sdcSchema = this.tryReadSdcYaml(fsPath);
      const isReact = fileName.endsWith('.jsx') || fileName.endsWith('.tsx');
      const isAngular = fileName.endsWith('.component.html');

      const parsedAst = isReact
        ? this.parserReact.parse(sourceCode, fileName)
        : this.parserTwigAngular.parse(sourceCode, fileName, sdcSchema);

      const fileOntology = SemanticMetricsEngine.process(parsedAst, weights);
      const totalEstimatedLines = this.sumAllBlockLines(fileOntology.rootNodes);

      const nodeId = `ws-file-${fileCounter}`;
      const cluster: IndexedWorkspaceFile['cluster'] = sdcSchema
        ? 'sdc'
        : isReact
        ? 'react'
        : isAngular
        ? 'angular'
        : 'twig';

      const outgoing = this.extractCrossFileDependencies(sourceCode, parsedAst.metadata, isReact);

      const record: IndexedWorkspaceFile = {
        nodeId,
        fsPath,
        relativePath,
        fileName,
        cluster,
        ontology: fileOntology,
        totalEstimatedLines,
        rawOutgoingTargets: outgoing
      };

      // Rejestracja kluczy identyfikacyjnych dla Resolvera
      byFileName.set(fileName, record);
      const baseComponentName = fileName
        .replace(/\.(html\.twig|twig|jsx|tsx|component\.html)$/, '')
        .toLowerCase();

      if (sdcSchema) {
        record.sdcId = baseComponentName;
        bySdcName.set(baseComponentName, record);
      }

      if (isReact || isAngular) {
        record.reactOrNgSymbol = baseComponentName.replace(/[^a-z0-9]/g, '');
        byComponentSymbol.set(record.reactOrNgSymbol, record);
      }

      indexedFiles.push(record);
    }

    progress?.report({ message: 'Rozwiązywanie powiązań SDC, Makr Twig i importów...', increment: 15 });

    // 2. Budowanie międzyplikowych krawędzi relacji
    const crossFileRelations: OntologyRelation[] = [];
    const globalWordCounts = new Map<string, number>();
    let globalBestSig: { word: string; score: number } | null = null;

    for (const fileRec of indexedFiles) {
      // Agregacja globalnych statystyk słownych całego workspace
      const freq = fileRec.ontology.globalMetrics.globalMostFrequent;
      if (freq) {
        globalWordCounts.set(freq.word, (globalWordCounts.get(freq.word) || 0) + freq.count);
      }
      const sig = fileRec.ontology.globalMetrics.globalMostSignificant;
      if (sig && (!globalBestSig || sig.score > globalBestSig.score)) {
        globalBestSig = { word: sig.word, score: sig.score };
      }

      // Rozwiązywanie krawędzi wychodzących (SDC, Twig Include/Macro, React/Angular)
      for (const dep of fileRec.rawOutgoingTargets) {
        const targetRec = this.resolveTargetRecord(
          dep.targetKey,
          bySdcName,
          byFileName,
          byComponentSymbol
        );

        if (targetRec && targetRec.nodeId !== fileRec.nodeId) {
          const exists = crossFileRelations.some(
            (r) => r.fromId === fileRec.nodeId && r.toId === targetRec.nodeId && r.label === dep.label
          );
          if (!exists) {
            crossFileRelations.push({
              fromId: fileRec.nodeId,
              toId: targetRec.nodeId,
              type: dep.relationType,
              label: dep.label
            });
          }
        }
      }
    }

    // 3. Łączenie plików o tym samym głównym koncepcie semantycznym (Cross-File Semantic Similarity)
    for (let i = 0; i < indexedFiles.length; i++) {
      for (let j = i + 1; j < indexedFiles.length; j++) {
        const fileA = indexedFiles[i];
        const fileB = indexedFiles[j];
        const wordA = fileA.ontology.globalMetrics.globalMostSignificant?.word;
        const wordB = fileB.ontology.globalMetrics.globalMostSignificant?.word;

        if (wordA && wordB && wordA === wordB) {
          crossFileRelations.push({
            fromId: fileA.nodeId,
            toId: fileB.nodeId,
            type: 'semantic-similarity',
            label: `shared concept: "${wordA}"`
          });
        }
      }
    }

    // 4. Grupowanie węzłów plików w 4 klastry architektoniczne
    const clustersConfig: Array<{
      key: IndexedWorkspaceFile['cluster'];
      title: string;
      origin: OntologyNodeData['frameworkOrigin'];
    }> = [
      { key: 'sdc', title: 'cluster:Drupal SDC Components (*.component.yml)', origin: 'twig' },
      { key: 'twig', title: 'cluster:Twig Templates & Macros (*.twig)', origin: 'twig' },
      { key: 'react', title: 'cluster:React JSX/TSX Components', origin: 'react' },
      { key: 'angular', title: 'cluster:Angular Templates (*.component.html)', origin: 'angular' }
    ];

    const clusterRootNodes: OntologyNodeData[] = [];

    for (const c of clustersConfig) {
      const filesInCluster = indexedFiles.filter((f) => f.cluster === c.key);
      if (filesInCluster.length === 0) continue;

      const childrenNodes: OntologyNodeData[] = filesInCluster.map((f) => ({
        id: f.nodeId,
        tagOrComponent: `${f.relativePath}`,
        frameworkOrigin: c.origin,
        layoutType: 'block',
        cssFrameworkHints: [
          `${f.ontology.globalMetrics.totalBlocks} blocks`,
          ...(f.ontology.rootNodes[0]?.cssFrameworkHints.slice(0, 2) || [])
        ],
        metrics: {
          estimatedTextLines: Math.min(Math.max(f.totalEstimatedLines, 1), 15),
          isDynamicContent: true,
          mostFrequentWord: f.ontology.globalMetrics.globalMostFrequent,
          mostSignificantWord: f.ontology.globalMetrics.globalMostSignificant
        },
        // Przekazujemy pełną ścieżkę pliku w atrybucie pomocniczym do otwierania po kliknięciu
        children: f.ontology.rootNodes.slice(0, 3) // Podgląd głównych sekcji wewnątrz karty pliku
      }));

      clusterRootNodes.push({
        id: `cluster-${c.key}`,
        tagOrComponent: c.title,
        frameworkOrigin: c.origin,
        layoutType: 'grid',
        cssFrameworkHints: [`${filesInCluster.length} files`, 'workspace-cluster'],
        metrics: {
          estimatedTextLines: 0,
          isDynamicContent: false,
          mostFrequentWord: null,
          mostSignificantWord: null
        },
        children: childrenNodes
      });
    }

    let globalMostFrequent: { word: string; count: number } | null = null;
    for (const [word, count] of globalWordCounts.entries()) {
      if (!globalMostFrequent || count > globalMostFrequent.count) {
        globalMostFrequent = { word, count };
      }
    }

    return {
      fileName: `WORKSPACE ONTOLOGY (${indexedFiles.length} plików UI)`,
      globalMetrics: {
        totalBlocks: indexedFiles.length,
        globalMostFrequent,
        globalMostSignificant: globalBestSig
      },
      rootNodes: clusterRootNodes,
      relations: crossFileRelations
    };
  }

  /**
   * Wyciąga deklaracje zależności międzyplikowych z kodu źródłowego (SDC, Twig Import/Include, JSX Tag)
   */
  private static extractCrossFileDependencies(
    sourceCode: string,
    metadata: Record<string, string>,
    isReact: boolean
  ): IndexedWorkspaceFile['rawOutgoingTargets'] {
    const deps: IndexedWorkspaceFile['rawOutgoingTargets'] = [];

    if (!isReact) {
      // A. Drupal SDC & Twig {% include / embed 'provider:component' %}
      const incRegex = /\{%\s*(include|embed)\s+['"]([^'"]+)['"]/g;
      for (const m of sourceCode.matchAll(incRegex)) {
        const verb = m[1];
        const rawTarget = m[2];
        const isSdc = rawTarget.includes(':') && !rawTarget.startsWith('@');
        deps.push({
          targetKey: rawTarget,
          relationType: isSdc ? 'prop-binding' : 'twig-include',
          label: `${isSdc ? 'SDC' : verb}: ${rawTarget}`
        });
      }

      // B. Twig Macro Imports: {% import 'macros/ui.html.twig' as ui %}
      const macroImpRegex = /\{%\s*import\s+['"]([^'"]+)['"]\s+as\s+([a-zA-Z0-9_]+)\s*%\}/g;
      for (const m of sourceCode.matchAll(macroImpRegex)) {
        deps.push({
          targetKey: m[1],
          relationType: 'prop-binding',
          label: `macro import (${m[2]}): ${path.basename(m[1])}`
        });
      }
    } else {
      // C. Komponenty React użyte w JSX: <UserProfileCard />
      const jsxCompRegex = /<([A-Z][a-zA-Z0-9_]+)/g;
      for (const m of sourceCode.matchAll(jsxCompRegex)) {
        deps.push({
          targetKey: m[1],
          relationType: 'prop-binding',
          label: `<${m[1]} />`
        });
      }
    }

    return deps;
  }

  private static resolveTargetRecord(
    rawKey: string,
    bySdcName: Map<string, IndexedWorkspaceFile>,
    byFileName: Map<string, IndexedWorkspaceFile>,
    byComponentSymbol: Map<string, IndexedWorkspaceFile>
  ): IndexedWorkspaceFile | undefined {
    // 1. Jeśli to Drupal SDC np. 'ddna:genome-card' -> szukamy 'genome-card'
    if (rawKey.includes(':')) {
      const sdcComponentName = rawKey.split(':')[1].toLowerCase();
      if (bySdcName.has(sdcComponentName)) return bySdcName.get(sdcComponentName);
      if (byFileName.has(`${sdcComponentName}.twig`)) return byFileName.get(`${sdcComponentName}.twig`);
      if (byFileName.has(`${sdcComponentName}.html.twig`)) return byFileName.get(`${sdcComponentName}.html.twig`);
    }

    // 2. Jeśli to ścieżka do szablonu Twig np. '@theme/partials/header.html.twig'
    const base = path.basename(rawKey);
    if (byFileName.has(base)) return byFileName.get(base);

    // 3. Jeśli to nazwa komponentu React/Angular np. 'UserProfileCard'
    const cleanSymbol = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (byComponentSymbol.has(cleanSymbol)) return byComponentSymbol.get(cleanSymbol);

    return undefined;
  }

  private static sumAllBlockLines(nodes: OntologyNodeData[]): number {
    let total = 0;
    for (const n of nodes) {
      total += n.metrics.estimatedTextLines;
      if (n.children.length > 0) {
        total += this.sumAllBlockLines(n.children);
      }
    }
    return total;
  }

  private static tryReadSdcYaml(twigFilePath: string): SdcYamlSchemaMetadata | undefined {
    try {
      const dir = path.dirname(twigFilePath);
      const baseName = path.basename(twigFilePath, path.extname(twigFilePath)).replace(/\.html$/, '');
      const ymlPath = path.join(dir, `${baseName}.component.yml`);
      if (fs.existsSync(ymlPath)) {
        const content = fs.readFileSync(ymlPath, 'utf8');
        const nameMatch = content.match(/^name:\s*(['"]?)([^'"\n]+)\1/m);
        return { name: nameMatch ? nameMatch[2] : baseName };
      }
    } catch {
      // Ignoruj błędy I/O
    }
    return undefined;
  }
}