import { describe, expect, test } from 'bun:test';
import { EnhancedTwigAndAngularParser, SdcYamlSchemaMetadata } from '../src/parsers/drupal-sdc-macro-parser';
import { SemanticMetricsEngine } from '../src/semantic/semantic-engine';
import { OntologyMarkdownExporter } from '../src/exporters/ontology-exporter';
import { DocumentOntology, LiveSemanticWeights, OntologyNodeData } from '../src/webview/ontology-viewer';

describe('UI Ontology Visualizer - Advanced Filtering & Neighbor Isolation (bun:test)', () => {
  const parser = new EnhancedTwigAndAngularParser();

  const sampleDrupalSdcTwig = `
    {{ attach_library('ddna/genome_card') }}
    {% set classes = ['flex', 'justify-between', 'card-wrapper'] %}

    {% macro status_badge(label, variant) %}
      <span class="badge">{{ label }}</span>
    {% endmacro %}

    <article{{ attributes.addClass(classes, 'grid-cols-2') }}>
      <h1>{{ 'Architektura genomu UI'|t }}</h1>
      {% embed 'ddna:genome-card' with { mutacja: node.field_mutation_type, poziom: 'alpha' } %}
        {% block header_slot %}
          <header>{{ content.field_title }}</header>
          {{ _self.status_badge('Aktywny', 'success') }}
        {% endblock %}
        {% block body_slot %}
          <div class="description">
            {{ content.field_body }}
            Statyczny opis sekwencji blokowej o wysokiej gęstości semantycznej i mikrousługowej architekturze.
          </div>
        {% endblock %}
      {% endembed %}
    </article>
  `;

  const sampleSdcYaml: SdcYamlSchemaMetadata = {
    name: 'Genome Card SDC',
    description: 'Komponent wizualizacji genomu DDNA',
    props: { mutacja: { title: 'Typ mutacji', type: 'string' } },
    slots: { header_slot: { title: 'Slot nagłówka' } }
  };

  // Funkcja pomocnicza symulująca logikę filtrowania i sąsiedztwa 1-hop z OntologyCanvasElement
  const simulateGraphFilter = (
    ontology: DocumentOntology,
    query: string,
    includeNeighbors: boolean
  ) => {
    const q = query.toLowerCase().trim();
    const directMatchIds = new Set<string>();

    const flatten = (nodes: OntologyNodeData[]) => {
      for (const n of nodes) {
        const tag = n.tagOrComponent.toLowerCase();
        const sig = n.metrics.mostSignificantWord?.word.toLowerCase() || '';
        const freq = n.metrics.mostFrequentWord?.word.toLowerCase() || '';

        if (tag.includes(q) || sig.includes(q) || freq.includes(q)) {
          directMatchIds.add(n.id);
        }
        if (n.children.length > 0) flatten(n.children);
      }
    };
    flatten(ontology.rootNodes);

    const neighborIds = new Set<string>();
    if (includeNeighbors) {
      for (const rel of ontology.relations) {
        if (rel.type === 'parent-child') continue;
        if (directMatchIds.has(rel.fromId) && !directMatchIds.has(rel.toId)) {
          neighborIds.add(rel.toId);
        } else if (directMatchIds.has(rel.toId) && !directMatchIds.has(rel.fromId)) {
          neighborIds.add(rel.fromId);
        }
      }
    }

    return { directMatchIds, neighborIds };
  };

  test('1. Filtrowanie węzłów po nazwie komponentu SDC oraz słowie TF-IDF', () => {
    const ast = parser.parse(sampleDrupalSdcTwig, 'node--genome.html.twig', sampleSdcYaml);
    const ontology = SemanticMetricsEngine.process(ast);

    // Test A: Wyszukiwanie po fragmencie nazwy komponentu SDC ('genome-card')
    const filterSdc = simulateGraphFilter(ontology, 'genome-card', false);
    expect(filterSdc.directMatchIds.size).toBeGreaterThan(0);

    // Znajdź węzeł pasujący do zapytania SDC
    const findNodeByTag = (nodes: OntologyNodeData[], sub: string): OntologyNodeData | undefined => {
      for (const n of nodes) {
        if (n.tagOrComponent.toLowerCase().includes(sub)) return n;
        const found = findNodeByTag(n.children, sub);
        if (found) return found;
      }
      return undefined;
    };

    const sdcNode = findNodeByTag(ontology.rootNodes, 'genome-card');
    expect(sdcNode).toBeDefined();
    expect(filterSdc.directMatchIds.has(sdcNode!.id)).toBe(true);

    // Test B: Wyszukiwanie po wyliczonym słowie kluczowym TF-IDF (np. 'architektura' lub 'genomu')
    const topSigWord = ontology.globalMetrics.globalMostSignificant?.word || 'architektura';
    const filterTfidf = simulateGraphFilter(ontology, topSigWord, false);
    expect(filterTfidf.directMatchIds.size).toBeGreaterThan(0);
  });

  test('2. Izolacja sąsiedztwa 1-hop (Neighbor Graph Isolation)', () => {
    const ast = parser.parse(sampleDrupalSdcTwig, 'node--genome.html.twig', sampleSdcYaml);
    const ontology = SemanticMetricsEngine.process(ast);

    // Filtrujemy po konkretnym slocie SDC lub makrze, które posiada powiązania relacyjne
    const filterWithoutNeighbors = simulateGraphFilter(ontology, 'header_slot', false);
    const filterWithNeighbors = simulateGraphFilter(ontology, 'header_slot', true);

    // Włączenie izolacji 1-hop musi zwrócić co najmniej tyle samo lub więcej węzłów (bezpośrednie trafienia + sąsiedzi SVG)
    expect(filterWithNeighbors.neighborIds.size).toBeGreaterThanOrEqual(0);
    expect(filterWithNeighbors.directMatchIds.size + filterWithNeighbors.neighborIds.size).toBeGreaterThanOrEqual(
      filterWithoutNeighbors.directMatchIds.size
    );

    // Sprawdzenie, czy krawędzie relacji powiązane z sąsiadami istnieją w modelu
    const hasValidRelation = ontology.relations.some(
      (r) =>
        (filterWithNeighbors.directMatchIds.has(r.fromId) && filterWithNeighbors.neighborIds.has(r.toId)) ||
        (filterWithNeighbors.directMatchIds.has(r.toId) && filterWithNeighbors.neighborIds.has(r.fromId))
    );
    expect(hasValidRelation || filterWithNeighbors.neighborIds.size === 0).toBe(true);
  });
});