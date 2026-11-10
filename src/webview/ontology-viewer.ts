// Typy danych współdzielone z procesem głównym (Extension Host)
export interface OntologyNodeData {
  id: string;
  tagOrComponent: string; // np. 'div', 'article', 'UserProfileComponent', 'twig:block:content'
  frameworkOrigin: 'html' | 'twig' | 'react' | 'angular';
  layoutType: 'block' | 'flex' | 'grid' | 'inline' | 'unknown';
  cssFrameworkHints: string[]; // np. ['tailwind:flex', 'bootstrap:col-6']
  metrics: {
    estimatedTextLines: number;
    isDynamicContent: boolean;
    mostFrequentWord: { word: string; count: number } | null;
    mostSignificantWord: { word: string; score: number } | null;
  };
  children: OntologyNodeData[];
}

export interface OntologyRelation {
  fromId: string;
  toId: string;
  type: 'parent-child' | 'twig-include' | 'prop-binding' | 'semantic-similarity';
  label?: string;
}

export interface DocumentOntology {
  fileName: string;
  globalMetrics: {
    totalBlocks: number;
    globalMostFrequent: { word: string; count: number } | null;
    globalMostSignificant: { word: string; score: number } | null;
    metadataExtracted: Record<string, string>; // title, meta description, itp.
  };
  rootNodes: OntologyNodeData[];
  relations: OntologyRelation[];
}

export type FilterScope = 'all' | 'sdc-macro' | 'tfidf-words' | 'css-layout';

//Animations Configurable.
export type ClickAnimationType = 'pulse-ripple' | 'elastic-flash';
export type HoverAnimationType = 'lift-neon' | 'shimmer-focus';

export interface LiveSemanticWeights {
  h1Weight: number;          // Domyślnie: 5.0 (zakres 1.0 - 10.0)
  sdcWeight: number;         // Domyślnie: 3.8 (zakres 1.0 - 10.0)
  twigMacroWeight: number;   // Domyślnie: 2.8 (zakres 1.0 - 10.0)
  charsPerLine: number;      // Domyślnie: 65  (zakres 20 - 140 znaków na linię)
}

export interface UiConfiguration {
  clickAnimation: ClickAnimationType;
  hoverAnimation: HoverAnimationType;
  weights: LiveSemanticWeights;
}

export const DEFAULT_UI_CONFIG: UiConfiguration = {
  clickAnimation: 'pulse-ripple',
  hoverAnimation: 'lift-neon',
  weights: {
    h1Weight: 5.0,
    sdcWeight: 3.8,
    twigMacroWeight: 2.8,
    charsPerLine: 65
  }
};

export let currentUiConfig: UiConfiguration = structuredClone(DEFAULT_UI_CONFIG);

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

/**
 * Komponent pojedynczego węzła blokowego: <ontology-node>
 * Renderuje ramkę architektoniczną, odznaki słów (TF-IDF) oraz puste linie tekstu (Skeleton Lines).
 */
export class OntologyNodeElement extends HTMLElement {
  private _data!: OntologyNodeData;
  private filterQuery: string = '';
  private filterScope: FilterScope = 'all';
  private includeOneHopNeighbors: boolean = true;
  private hideUnmatchedBranches: boolean = false;
  private activeVisibleNodeIds: Set<string> | null = null; // null = brak aktywnego filtra (wszystkie widoczne)

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set data(value: OntologyNodeData) {
    this._data = value;
    this.setAttribute('data-node-id', value.id);
    this.render();
  }

  get data(): OntologyNodeData {
    return this._data;
  }

  private getSearchToolbarStyles(): string {
    return `
      .filter-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 16px;
        margin-bottom: 16px;
        background: var(--vscode-editorWidget-background, #252526);
        border: 1px solid var(--vscode-widget-border, #454545);
        border-radius: 6px;
      }

      .search-input-group {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 340px;
      }

      .search-box-wrapper {
        position: relative;
        flex: 1;
        display: flex;
        align-items: center;
      }

      .search-input {
        width: 100%;
        padding: 6px 28px 6px 10px;
        background: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 4px;
        font-size: 12px;
        outline: none;
      }

      .search-input:focus {
        border-color: var(--vscode-focusBorder, #007fd4);
      }

      .clear-search-btn {
        position: absolute;
        right: 6px;
        background: transparent;
        border: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 12px;
        padding: 2px 4px;
        display: none;
      }

      .clear-search-btn.visible {
        display: block;
      }

      .filter-options-group {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        font-size: 11px;
      }

      .match-counter-badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
    `;
  }

  private getStyles(): string {
    return `
      :host {
        display: block;
        position: relative;
        box-sizing: border-box;
        margin: 8px 0;
        font-family: var(--vscode-font-family, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-editor-foreground);
      }

      .node-card {
        border: 1px solid var(--vscode-widget-border, #454545);
        background-color: var(--vscode-editorWidget-background, #252526);
        border-radius: 6px;
        padding: 10px;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }

      /* === WARIANTY ANIMACJI HOVER (Sub-ui-2) === */
      
      /* Wariant 1: 3D Lift & Neon Border */
      :host([data-hover-anim="lift-neon"]) .node-card:hover {
        transform: translateY(-3px) scale(1.005);
        border-color: var(--vscode-focusBorder, #007fd4);
        box-shadow: 0 6px 20px rgba(0, 127, 212, 0.25), 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.4));
      }

      /* Wariant 2: Skeleton Shimmer & Relation Focus */
      :host([data-hover-anim="shimmer-focus"]) .node-card:hover {
        border-color: var(--vscode-charts-purple, #b180d7);
        box-shadow: 0 0 12px rgba(177, 128, 215, 0.2);
      }
      :host([data-hover-anim="shimmer-focus"]) .node-card:hover .skeleton-line {
        background: linear-gradient(
          90deg,
          var(--vscode-editorInlayHint-background, rgba(128, 128, 128, 0.25)) 0%,
          var(--vscode-charts-purple, #b180d7) 50%,
          var(--vscode-editorInlayHint-background, rgba(128, 128, 128, 0.25)) 100%
        );
        background-size: 200% 100%;
        animation: shimmer 1.2s infinite linear;
      }

      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* === WARIANTY ANIMACJI KLIKNIĘCIA (Sub-ui-1) === */

      /* Wariant 1: Pulse RippleWave */
      @keyframes pulseRipple {
        0% { box-shadow: 0 0 0 0 rgba(0, 127, 212, 0.7); }
        70% { box-shadow: 0 0 0 14px rgba(0, 127, 212, 0); }
        100% { box-shadow: 0 0 0 0 rgba(0, 127, 212, 0); }
      }
      .node-card.animate-pulse-ripple {
        animation: pulseRipple 0.55s ease-out;
      }

      /* Wariant 2: Elastic Bounce & Flash */
      @keyframes elasticFlash {
        0% { transform: scale(1); filter: brightness(1); }
        30% { transform: scale(0.97); filter: brightness(1.4); border-color: var(--vscode-charts-yellow, #cca700); }
        60% { transform: scale(1.02); filter: brightness(1.2); }
        100% { transform: scale(1); filter: brightness(1); }
      }
      .node-card.animate-elastic-flash {
        animation: elasticFlash 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }

      /* Wyróżnienie kolorystyczne dla różnych frameworków na lewej krawędzi */
      .node-card[data-origin="twig"] { border-left: 4px solid #bacf29; }
      .node-card[data-origin="react"] { border-left: 4px solid #61dafb; }
      .node-card[data-origin="angular"] { border-left: 4px solid #dd0031; }
      .node-card[data-origin="html"] { border-left: 4px solid #e34f26; }

      .node-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding-bottom: 8px;
        margin-bottom: 8px;
        border-bottom: 1px dashed var(--vscode-widget-border, #454545);
      }

      .title-group {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .tag-name {
        font-family: var(--vscode-editor-font-family, monospace);
        font-weight: 600;
        color: var(--vscode-symbolIcon-classForeground, #ee9d28);
        cursor: pointer;
      }

      .layout-badge {
        font-size: 10px;
        text-transform: uppercase;
        padding: 2px 5px;
        border-radius: 3px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }

      .css-hint {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family, monospace);
      }

      /* Odznaki słów kluczowych i popularnych */
      .semantic-badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .word-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 10px;
        font-weight: 500;
      }

      .word-pill.frequent {
        background-color: rgba(55, 148, 255, 0.15);
        color: var(--vscode-charts-blue, #3794ff);
        border: 1px solid rgba(55, 148, 255, 0.4);
      }

      .word-pill.significant {
        background-color: rgba(187, 128, 9, 0.18);
        color: var(--vscode-charts-yellow, #cca700);
        border: 1px solid rgba(187, 128, 9, 0.4);
      }

      .pill-meta {
        opacity: 0.75;
        font-size: 10px;
      }

      /* Puste linie reprezentujące objętość tekstu (Skeleton Lines) */
      .skeleton-lines-container {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin: 8px 0;
        padding: 6px;
        background: var(--vscode-editor-background);
        border-radius: 4px;
      }

      .skeleton-line {
        height: 7px;
        border-radius: 3px;
        background-color: var(--vscode-editorInlayHint-background, rgba(128, 128, 128, 0.25));
        position: relative;
        overflow: hidden;
      }

      /* Ostatnia linia akapitu naturalnie krótsza */
      .skeleton-line:last-child:not(:only-child) {
        width: 65%;
      }

      /* Oznaczenie dla dynamicznych zmiennych np. {{ content }} lub {children} */
      .skeleton-line.dynamic {
        background: repeating-linear-gradient(
          45deg,
          rgba(128, 128, 128, 0.15),
          rgba(128, 128, 128, 0.15) 6px,
          rgba(128, 128, 128, 0.35) 6px,
          rgba(128, 128, 128, 0.35) 12px
        );
      }

      /* Układ dzieci w zależności od wykrytego CSS (Flex / Grid / Block) */
      .children-slot {
        margin-top: 8px;
        padding-left: 10px;
        border-left: 1px solid var(--vscode-editorIndentGuide-background, #404040);
      }

      .children-slot.layout-flex {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .children-slot.layout-flex > ::slotted(*) {
        flex: 1 1 220px;
      }

      .children-slot.layout-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }
    `;
  }

  private renderSkeletonLines(count: number, isDynamic: boolean): string {
    if (count <= 0) return '';
    const cappedCount = Math.min(count, 25); // Zabezpieczenie przed gigantycznymi blokami tekstu
    const linesHtml = Array.from({ length: cappedCount })
      .map(() => `<div class="skeleton-line ${isDynamic ? 'dynamic' : ''}"></div>`)
      .join('');

    return `
      <div class="skeleton-lines-container" title="Szacowana liczba linii tekstu: ${count} (${isDynamic ? 'zawartość dynamiczna' : 'statyczny tekst'})">
        ${linesHtml}
      </div>
    `;
  }

  private renderFilterBar(): string {
    return `
      <div class="filter-bar">
        <div class="search-input-group">
          <div class="search-box-wrapper">
            <input
              type="search"
              id="ontology-search-input"
              class="search-input"
              placeholder="🔍 Filtruj po komponencie SDC, makrze Twig, słowie TF-IDF lub klasie CSS... (Ctrl+F)"
              value="${this.escapeXml(this.filterQuery)}"
            />
            <button id="clear-search-btn" class="clear-search-btn ${this.filterQuery ? 'visible' : ''}" title="Wyczyść filtr (Esc)">✕</button>
          </div>
          <select id="ontology-search-scope" title="Zakres wyszukiwania">
            <option value="all" ${this.filterScope === 'all' ? 'selected' : ''}>Zakres: Wszystko</option>
            <option value="sdc-macro" ${this.filterScope === 'sdc-macro' ? 'selected' : ''}>Tylko SDC & Twig Macros</option>
            <option value="tfidf-words" ${this.filterScope === 'tfidf-words' ? 'selected' : ''}>Tylko słowa TF-IDF (🔥/🎯)</option>
            <option value="css-layout" ${this.filterScope === 'css-layout' ? 'selected' : ''}>Układ i klasy CSS</option>
          </select>
        </div>

        <div class="filter-options-group">
          <label class="legend-toggle" title="Zachowaj również komponenty połączone relacjami SVG z wyszukanym węzłem">
            <input type="checkbox" id="toggle-1hop-neighbors" ${this.includeOneHopNeighbors ? 'checked' : ''} />
            Izoluj sąsiadów (1-hop)
          </label>
          <label class="legend-toggle" title="Ukryj całkowicie gałęzie drzewa, które nie pasują do filtra">
            <input type="checkbox" id="toggle-hide-unmatched" ${this.hideUnmatchedBranches ? 'checked' : ''} />
            Ukryj niepasujące gałęzie
          </label>
          <span class="match-counter-badge" id="filter-match-counter">Wszystkie węzły</span>
        </div>
      </div>
    `;
  }

  private bindDrawerEvents(): void {
    if (!this.shadowRoot) return;

    const drawer = this.shadowRoot.getElementById('config-drawer');
    const openBtn = this.shadowRoot.getElementById('open-config-btn');
    const closeBtn = this.shadowRoot.getElementById('close-drawer');

    openBtn?.addEventListener('click', () => {
      this.isDrawerOpen = !this.isDrawerOpen;
      drawer?.classList.toggle('open', this.isDrawerOpen);
    });

    closeBtn?.addEventListener('click', () => {
      this.isDrawerOpen = false;
      drawer?.classList.remove('open');
    });

    const sliderH1 = this.shadowRoot.getElementById('slider-h1') as HTMLInputElement;
    const sliderSdc = this.shadowRoot.getElementById('slider-sdc') as HTMLInputElement;
    const sliderMacro = this.shadowRoot.getElementById('slider-macro') as HTMLInputElement;
    const sliderChars = this.shadowRoot.getElementById('slider-chars') as HTMLInputElement;

    const valH1 = this.shadowRoot.getElementById('val-h1')!;
    const valSdc = this.shadowRoot.getElementById('val-sdc')!;
    const valMacro = this.shadowRoot.getElementById('val-macro')!;
    const valChars = this.shadowRoot.getElementById('val-chars')!;

    const triggerLiveRecalculation = () => {
      currentUiConfig.weights = {
        h1Weight: parseFloat(sliderH1.value),
        sdcWeight: parseFloat(sliderSdc.value),
        twigMacroWeight: parseFloat(sliderMacro.value),
        charsPerLine: parseInt(sliderChars.value, 10)
      };

      valH1.textContent = `${currentUiConfig.weights.h1Weight.toFixed(1)}x`;
      valSdc.textContent = `${currentUiConfig.weights.sdcWeight.toFixed(1)}x`;
      valMacro.textContent = `${currentUiConfig.weights.twigMacroWeight.toFixed(1)}x`;
      valChars.textContent = `${currentUiConfig.weights.charsPerLine} zn.`;

      if (this.sliderDebounceTimer) window.clearTimeout(this.sliderDebounceTimer);
      this.sliderDebounceTimer = window.setTimeout(() => {
        vscode.postMessage({
          command: 'liveUpdateWeights',
          payload: currentUiConfig.weights
        });
      }, 120);
    };

    [sliderH1, sliderSdc, sliderMacro, sliderChars].forEach((slider) => {
      slider?.addEventListener('input', triggerLiveRecalculation);
    });

    // Zmiana animacji Click & Hover w locie
    const selectClick = this.shadowRoot.getElementById('select-click-anim') as HTMLSelectElement;
    const selectHover = this.shadowRoot.getElementById('select-hover-anim') as HTMLSelectElement;

    const updateAnimations = () => {
      currentUiConfig.clickAnimation = selectClick.value as ClickAnimationType;
      currentUiConfig.hoverAnimation = selectHover.value as HoverAnimationType;
      this.applyHoverAttributeToNodes();
    };

    selectClick?.addEventListener('change', updateAnimations);
    selectHover?.addEventListener('change', updateAnimations);

    // Przycisk Resetuj
    this.shadowRoot.getElementById('reset-ui-config')?.addEventListener('click', () => {
      currentUiConfig = structuredClone(DEFAULT_UI_CONFIG);
      sliderH1.value = String(currentUiConfig.weights.h1Weight);
      sliderSdc.value = String(currentUiConfig.weights.sdcWeight);
      sliderMacro.value = String(currentUiConfig.weights.twigMacroWeight);
      sliderChars.value = String(currentUiConfig.weights.charsPerLine);
      selectClick.value = currentUiConfig.clickAnimation;
      selectHover.value = currentUiConfig.hoverAnimation;
      updateAnimations();
      triggerLiveRecalculation();
    });

    // Przycisk Zapisz w Workspace
    this.shadowRoot.getElementById('save-ui-config')?.addEventListener('click', () => {
      vscode.postMessage({
        command: 'saveUiConfig',
        payload: currentUiConfig
      });
    });
  }
  
  private isDrawerOpen = false;
  private sliderDebounceTimer: number | undefined;

  private getDrawerStyles(): string {
    return `
      .config-drawer {
        position: fixed;
        top: 0;
        right: -360px;
        width: 340px;
        height: 100vh;
        background: var(--vscode-sideBar-background, #252526);
        border-left: 1px solid var(--vscode-panel-border, #454545);
        box-shadow: -4px 0 16px rgba(0, 0, 0, 0.45);
        z-index: 100;
        transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }

      .config-drawer.open {
        right: 0;
      }

      .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        font-weight: 600;
        border-bottom: 1px solid var(--vscode-panel-border, #454545);
      }

      .drawer-body {
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
        border-bottom: 1px dashed var(--vscode-widget-border);
        padding-bottom: 4px;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .slider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      }

      .slider-val-badge {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 4px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-weight: 600;
      }

      input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 5px;
        border-radius: 3px;
        background: var(--vscode-input-background, #3c3c3c);
        outline: none;
        cursor: pointer;
      }

      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--vscode-progressBar-background, #0e70c0);
        border: 2px solid var(--vscode-editor-foreground, #ffffff);
        cursor: pointer;
        transition: transform 0.1s ease;
      }

      input[type="range"]::-webkit-slider-thumb:hover {
        transform: scale(1.2);
      }

      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 12px;
      }

      .drawer-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .primary-btn, .secondary-btn {
        flex: 1;
        padding: 7px 10px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        border: none;
        font-weight: 500;
      }

      .primary-btn {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .primary-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .secondary-btn {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
    `;
  }

  private renderConfigDrawer(): string {
    const { clickAnimation, hoverAnimation, weights } = currentUiConfig;

    return `
      <aside class="config-drawer ${this.isDrawerOpen ? 'open' : ''}" id="config-drawer">
        <div class="drawer-header">
          <span>⚙️ Konfigurowalne UI Pluginu</span>
          <button id="close-drawer" class="secondary-btn" style="flex:0; padding:2px 8px;">✕</button>
        </div>
        <div class="drawer-body">
          <div class="section-title">1. Animacje Interakcji</div>

          <div class="form-group">
            <label>Animacja Kliknięcia (Click):</label>
            <select id="select-click-anim">
              <option value="pulse-ripple" ${clickAnimation === 'pulse-ripple' ? 'selected' : ''}>1. Pulse RippleWave (Efekt fali)</option>
              <option value="elastic-flash" ${clickAnimation === 'elastic-flash' ? 'selected' : ''}>2. Elastic Bounce & Flash (Sprężyste odbicie)</option>
            </select>
          </div>

          <div class="form-group">
            <label>Animacja Najazdu (Hover):</label>
            <select id="select-hover-anim">
              <option value="lift-neon" ${hoverAnimation === 'lift-neon' ? 'selected' : ''}>1. 3D Lift & Neon Border (Uniesienie i neon)</option>
              <option value="shimmer-focus" ${hoverAnimation === 'shimmer-focus' ? 'selected' : ''}>2. Skeleton Shimmer & Relation Focus (Połysk linii)</option>
            </select>
          </div>

          <div class="section-title">2. Wagi Semantyczne DOM (Live TF-IDF)</div>

          <div class="form-group">
            <div class="slider-header">
              <label for="slider-h1">Nagłówki i Meta (&lt;h1&gt;, &lt;title&gt;):</label>
              <span class="slider-val-badge" id="val-h1">${weights.h1Weight.toFixed(1)}x</span>
            </div>
            <input type="range" id="slider-h1" min="1.0" max="10.0" step="0.2" value="${weights.h1Weight}" />
          </div>

          <div class="form-group">
            <div class="slider-header">
              <label for="slider-sdc">Komponenty Drupal SDC:</label>
              <span class="slider-val-badge" id="val-sdc">${weights.sdcWeight.toFixed(1)}x</span>
            </div>
            <input type="range" id="slider-sdc" min="1.0" max="10.0" step="0.2" value="${weights.sdcWeight}" />
          </div>

          <div class="form-group">
            <div class="slider-header">
              <label for="slider-macro">Twig Macros ({% macro %}):</label>
              <span class="slider-val-badge" id="val-macro">${weights.twigMacroWeight.toFixed(1)}x</span>
            </div>
            <input type="range" id="slider-macro" min="1.0" max="10.0" step="0.2" value="${weights.twigMacroWeight}" />
          </div>

          <div class="section-title">3. Estymator Pustych Linii Tekstu</div>

          <div class="form-group">
            <div class="slider-header">
              <label for="slider-chars">Próg znaków na 1 linię:</label>
              <span class="slider-val-badge" id="val-chars">${weights.charsPerLine} zn.</span>
            </div>
            <input type="range" id="slider-chars" min="20" max="140" step="5" value="${weights.charsPerLine}" />
          </div>

          <div class="drawer-actions">
            <button id="reset-ui-config" class="secondary-btn" title="Przywróć wartości domyślne">Resetuj</button>
            <button id="save-ui-config" class="primary-btn">Zapisz w Workspace</button>
          </div>
        </div>
      </aside>
    `;
  }

  /**
   * Sprawdza, czy pojedynczy węzeł OntologyNodeData pasuje do wpisanego zapytania i wybranego zakresu
   */
  private doesNodeMatchQuery(node: OntologyNodeData, query: string, scope: FilterScope): boolean {
    const q = query.toLowerCase().trim();
    if (!q) return true;

    const tag = node.tagOrComponent.toLowerCase();
    const freqWord = node.metrics.mostFrequentWord?.word.toLowerCase() || '';
    const sigWord = node.metrics.mostSignificantWord?.word.toLowerCase() || '';
    const cssHints = node.cssFrameworkHints.join(' ').toLowerCase();
    const layout = node.layoutType.toLowerCase();

    switch (scope) {
      case 'sdc-macro':
        return (
          (tag.includes('sdc:') || tag.includes('macro') || tag.includes(':')) &&
          tag.includes(q)
        );
      case 'tfidf-words':
        return freqWord.includes(q) || sigWord.includes(q);
      case 'css-layout':
        return cssHints.includes(q) || layout.includes(q);
      case 'all':
      default:
        return (
          tag.includes(q) ||
          freqWord.includes(q) ||
          sigWord.includes(q) ||
          cssHints.includes(q) ||
          layout.includes(q)
        );
    }
  }

  /**
   * Nakłada filtr na drzewo DOM komponentów <ontology-node>, wyznacza sąsiedztwo 1-hop
   * oraz przerysowuje siatkę powiązań SVG tylko dla widocznych węzłów.
   */
  private applyGraphFilter(): void {
    if (!this.shadowRoot || !this._ontology) return;

    const query = this.filterQuery.trim();
    const counterBadge = this.shadowRoot.getElementById('filter-match-counter');
    const clearBtn = this.shadowRoot.getElementById('clear-search-btn');

    clearBtn?.classList.toggle('visible', query.length > 0);

    // Zbierz wszystkie wyrenderowane elementy <ontology-node> w drzewie
    const allNodeElements: OntologyNodeElement[] = [];
    const collectNodes = (root: ParentNode) => {
      const children = Array.from(root.querySelectorAll('ontology-node')) as OntologyNodeElement[];
      for (const el of children) {
        if (!allNodeElements.includes(el)) {
          allNodeElements.push(el);
          collectNodes(el);
        }
      }
    };
    collectNodes(this.shadowRoot);

    // Brak filtra -> przywróć pełną widoczność wszystkich węzłów i krawędzi SVG
    if (!query) {
      this.activeVisibleNodeIds = null;
      for (const el of allNodeElements) {
        el.removeAttribute('data-filter-state');
      }
      if (counterBadge) {
        counterBadge.textContent = `Wszystkie (${allNodeElements.length})`;
      }
      requestAnimationFrame(() => this.drawRelationsSvg());
      return;
    }

    // 1. Wyznaczenie bezpośrednich trafień (Direct Matches)
    const directMatchIds = new Set<string>();
    for (const el of allNodeElements) {
      if (this.doesNodeMatchQuery(el.data, query, this.filterScope)) {
        directMatchIds.add(el.data.id);
      }
    }

    // 2. Wyznaczenie sąsiadów 1-hop z relacji ontologicznych (SDC, Twig Macros, Props, Semantic Similarity)
    const neighborIds = new Set<string>();
    if (this.includeOneHopNeighbors) {
      for (const rel of this._ontology.relations) {
        if (rel.type === 'parent-child') continue;
        if (directMatchIds.has(rel.fromId) && !directMatchIds.has(rel.toId)) {
          neighborIds.add(rel.toId);
        } else if (directMatchIds.has(rel.toId) && !directMatchIds.has(rel.fromId)) {
          neighborIds.add(rel.fromId);
        }
      }
    }

    // 3. Wyznaczenie przodków (Ancestors), którzy muszą pozostać rozwinięci, aby pokazać zagnieżdżone trafienia
    const ancestorIdsToKeepOpen = new Set<string>();
    const markAncestors = (node: OntologyNodeData, parentsChain: string[]) => {
      const isRelevant = directMatchIds.has(node.id) || neighborIds.has(node.id);
      if (isRelevant) {
        for (const pid of parentsChain) {
          ancestorIdsToKeepOpen.add(pid);
        }
      }
      for (const child of node.children) {
        markAncestors(child, [...parentsChain, node.id]);
      }
    };

    for (const root of this._ontology.rootNodes) {
      markAncestors(root, []);
    }

    // 4. Aktualizacja atrybutów wizualnych na komponentach <ontology-node>
    const visibleSet = new Set<string>();

    for (const el of allNodeElements) {
      const id = el.data.id;
      if (directMatchIds.has(id)) {
        el.setAttribute('data-filter-state', 'match');
        visibleSet.add(id);
      } else if (neighborIds.has(id)) {
        el.setAttribute('data-filter-state', 'neighbor');
        visibleSet.add(id);
      } else if (ancestorIdsToKeepOpen.has(id)) {
        // Kontener nadrzędny prowadzący do trafienia pozostaje widoczny
        el.setAttribute('data-filter-state', 'neighbor');
        visibleSet.add(id);
      } else {
        if (this.hideUnmatchedBranches) {
          el.setAttribute('data-filter-state', 'hidden-branch');
        } else {
          el.setAttribute('data-filter-state', 'dimmed');
        }
      }
    }

    this.activeVisibleNodeIds = visibleSet;

    if (counterBadge) {
      const neighborInfo = neighborIds.size > 0 ? ` + ${neighborIds.size} sąsiadów` : '';
      counterBadge.textContent = `Trafienia: ${directMatchIds.size}${neighborInfo}`;
    }

    // Przelicz współrzędne linii SVG po ewentualnym ukryciu niepasujących gałęzi
    requestAnimationFrame(() => this.drawRelationsSvg());
  }

  private render(): void {
    if (!this.shadowRoot || !this._data) return;

    const { tagOrComponent, frameworkOrigin, layoutType, cssFrameworkHints, metrics, children } = this._data;

    const freqBadge = metrics.mostFrequentWord
      ? `<span class="word-pill frequent" title="Najpopularniejsze słowo w tym bloku">
           🔥 ${metrics.mostFrequentWord.word} <span class="pill-meta">(${metrics.mostFrequentWord.count}x)</span>
         </span>`
      : '';

    const sigBadge = metrics.mostSignificantWord
      ? `<span class="word-pill significant" title="Najbardziej znaczące słowo (TF-IDF + wagi DOM)">
           🎯 ${metrics.mostSignificantWord.word} <span class="pill-meta">[${metrics.mostSignificantWord.score.toFixed(1)}]</span>
         </span>`
      : '';

    const hintsText = cssFrameworkHints.length > 0 ? `<span class="css-hint">.${cssFrameworkHints.join(' .')}</span>` : '';

    this.shadowRoot.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="node-card" data-origin="${frameworkOrigin}">
        <div class="node-header">
          <div class="title-group">
            <span class="tag-name" id="node-title">&lt;${tagOrComponent}&gt;</span>
            <span class="layout-badge">${layoutType}</span>
            ${hintsText}
          </div>
          <div class="semantic-badges">
            ${freqBadge}
            ${sigBadge}
          </div>
        </div>
        ${this.renderSkeletonLines(metrics.estimatedTextLines, metrics.isDynamicContent)}
        ${children && children.length > 0 ? `<div class="children-slot layout-${layoutType}"><slot></slot></div>` : ''}
      </div>
    `;

    // Kliknięcie w nagłówek komponentu wysyła sygnał do VS Code, aby podświetlić linię w kodzie
    this.shadowRoot.getElementById('node-title')?.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ command: 'revealNodeInEditor', nodeId: this._data.id });
    });

    // Rekurencyjne tworzenie węzłów potomnych w Light DOM (wstrzykiwanych do <slot>)
    this.innerHTML = '';
    if (children && children.length > 0) {
      children.forEach((childData) => {
        const childEl = document.createElement('ontology-node') as OntologyNodeElement;
        childEl.data = childData;
        this.appendChild(childEl);
      });
    }
  }
}

/**
 * Główny kontener widoku: <ontology-canvas>
 * Renderuje pasek globalnych metryk dokumentu, drzewo komponentów oraz warstwę SVG z krzywymi Beziera dla ontologii powiązań.
 */
export class OntologyCanvasElement extends HTMLElement {
  private _ontology: DocumentOntology | null = null;
  private resizeObserver: ResizeObserver;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.resizeObserver = new ResizeObserver(() => this.drawRelationsSvg());
  }

  connectedCallback(): void {
    this.resizeObserver.observe(this);
    window.addEventListener('scroll', () => this.drawRelationsSvg(), true);
  }

  disconnectedCallback(): void {
    this.resizeObserver.disconnect();
  }

  set ontology(value: DocumentOntology) {
    this._ontology = value;
    this.render();
    // Odczekaj na wyrenderowanie DOM przed obliczeniem współrzędnych dla linii SVG
    requestAnimationFrame(() => this.drawRelationsSvg());
  };
  // Dodatkowe style dla przycisków paska akcji w OntologyCanvasElement.getStyles():
  public actionBarStyles = `
    .action-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      font-size: 11px;
      font-weight: 500;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .toolbar-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .toolbar-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .toolbar-btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }`;

  private getStyles(): string {
    return `
      :host {
        display: block;
        position: relative;
        padding: 16px;
        min-height: 100vh;
        box-sizing: border-box;
      }

      .global-summary-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 16px;
        margin-bottom: 20px;
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
      }

      .file-title {
        font-weight: 600;
        font-size: 14px;
      }

      .global-badges {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
      }

      .legend-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        cursor: pointer;
        user-select: none;
      }

      .canvas-workspace {
        position: relative;
        z-index: 1;
      }

      :host([data-filter-state="match"]) > .node-card {
        border-color: var(--vscode-charts-yellow, #cca700) !important;
        box-shadow: 0 0 0 2px rgba(204, 167, 0, 0.35), 0 4px 14px rgba(0, 0, 0, 0.45);
      }

      :host([data-filter-state="neighbor"]) > .node-card {
        border-color: var(--vscode-charts-green, #89d185);
        border-style: dashed;
      }

      :host([data-filter-state="dimmed"]) > .node-card {
        opacity: 0.22;
        filter: grayscale(85%);
        transition: opacity 0.2s ease, filter 0.2s ease;
      }

      :host([data-filter-state="hidden-branch"]) {
        display: none !important;
      }

      /* Warstwa SVG dla relacji semantycznych i przepływu danych */
      svg.relations-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10;
        overflow: visible;
      }

      .relation-path {
        fill: none;
        stroke-width: 1.8px;
        opacity: 0.75;
      }

      .relation-path.semantic-similarity {
        stroke: var(--vscode-charts-purple, #b180d7);
        stroke-dasharray: 5, 5;
      }

      .relation-path.prop-binding,
      .relation-path.twig-include {
        stroke: var(--vscode-charts-green, #89d185);
      }

      .relation-label {
        font-size: 10px;
        fill: var(--vscode-editor-foreground);
        font-family: var(--vscode-editor-font-family, monospace);
      }
    `;
  }

  /**
   * Oblicza pozycje węzłów w drzewie i rysuje krzywe Beziera dla relacji w warstwie SVG
   */
  private drawRelationsSvg(): void {
    if (!this.shadowRoot || !this._ontology) return;
    const svg = this.shadowRoot.querySelector('svg.relations-overlay') as SVGSVGElement | null;
    const toggle = this.shadowRoot.querySelector('#toggle-relations') as HTMLInputElement | null;

    if (!svg) return;
    svg.innerHTML = '';

    if (toggle && !toggle.checked) return;

    const hostRect = this.getBoundingClientRect();

    // Rekurencyjne wyszukiwanie elementu po data-node-id (przeszukuje również zagnieżdżone sloty)
    const findNodeElement = (id: string): HTMLElement | null => {
      return this.shadowRoot!.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
    };

    this._ontology.relations
      .filter((rel) => rel.type !== 'parent-child') // Relacja parent-child wynika z samego zagnieżdżenia ramek
      .filter((rel) => {
        // Jeśli filtr wyszukiwania jest aktywny, rysuj tylko krawędzie dla aktywnego podgrafu
        if (!this.activeVisibleNodeIds) return true;
        return (
          this.activeVisibleNodeIds.has(rel.fromId) &&
          this.activeVisibleNodeIds.has(rel.toId)
        )
      })
      .forEach((rel) => {
        const fromEl = findNodeElement(rel.fromId);
        const toEl = findNodeElement(rel.toId);
        if (!fromEl || !toEl) return;``

        const r1 = fromEl.getBoundingClientRect();
        const r2 = toEl.getBoundingClientRect();

        // Punkt startowy (prawa krawędź bloku źródłowego) i końcowy (prawa krawędź bloku docelowego)
        const x1 = r1.right - hostRect.left - 12;
        const y1 = r1.top - hostRect.top + 20;
        const x2 = r2.right - hostRect.left - 12;
        const y2 = r2.top - hostRect.top + 20;

        const curveOffset = Math.max(Math.abs(y2 - y1) * 0.35, 45);
        const d = `M ${x1} ${y1} C ${x1 + curveOffset} ${y1}, ${x2 + curveOffset} ${y2}, ${x2} ${y2}`;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', `relation-path ${rel.type}`);
        svg.appendChild(path);

        if (rel.label) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(Math.max(x1, x2) + curveOffset * 0.6));
          text.setAttribute('y', String((y1 + y2) / 2));
          text.setAttribute('class', 'relation-label');
          text.textContent = rel.label;
          svg.appendChild(text);
        }
      });
    }

  private bindFilterEvents(): void {
    if (!this.shadowRoot) return;

    const searchInput = this.shadowRoot.getElementById('ontology-search-input') as HTMLInputElement | null;
    const clearBtn = this.shadowRoot.getElementById('clear-search-btn');
    const scopeSelect = this.shadowRoot.getElementById('ontology-search-scope') as HTMLSelectElement | null;
    const toggle1Hop = this.shadowRoot.getElementById('toggle-1hop-neighbors') as HTMLInputElement | null;
    const toggleHide = this.shadowRoot.getElementById('toggle-hide-unmatched') as HTMLInputElement | null;

    searchInput?.addEventListener('input', () => {
      this.filterQuery = searchInput.value;
      this.applyGraphFilter();
    });

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.filterQuery = '';
        searchInput.value = '';
        this.applyGraphFilter();
      }
    });

    clearBtn?.addEventListener('click', () => {
      if (!searchInput) return;
      this.filterQuery = '';
      searchInput.value = '';
      this.applyGraphFilter();
      searchInput.focus();
    });

    scopeSelect?.addEventListener('change', () => {
      this.filterScope = scopeSelect.value as FilterScope;
      this.applyGraphFilter();
    });

    toggle1Hop?.addEventListener('change', () => {
      this.includeOneHopNeighbors = toggle1Hop.checked;
      this.applyGraphFilter();
    });

    toggleHide?.addEventListener('change', () => {
      this.hideUnmatchedBranches = toggleHide.checked;
      this.applyGraphFilter();
    });

    // Globalny skrót Ctrl+F / Cmd+F wewnątrz Webview przenosi fokus bezpośrednio do pola filtrowania ontologii
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
    });
  }

  private render(): void {
    this.shadowRoot.innerHTML = `
      <style>${this.getStyles()} ${this.getDrawerStyles()} ${actionBarStyles}</style>
      <div class="global-summary-bar">
        <div>
          <div class="file-title">📄 ${fileName} <span style="opacity:0.6; font-weight:normal;">(${globalMetrics.totalBlocks} bloków)</span></div>
          <div class="global-badges" style="margin-top: 6px;">
            ${globalFreq}
            ${globalSig}
          </div>
        </div>
        <div class="action-toolbar">
          <label class="legend-toggle">
            <input type="checkbox" id="toggle-relations" checked />
            Siatka SVG
          </label>
          <button class="toolbar-btn" id="scan-workspace-btn" title="Zbuduj globalny graf powiązań wszystkich komponentów SDC, Makr Twig i React/Angular w projekcie">
            🌐 Mapa Workspace
          </button>
          <button class="toolbar-btn" id="export-md-btn" title="Eksportuj raport TF-IDF oraz graf Mermaid do pliku Markdown (.md)">
            📥 Eksport MD / Mermaid
          </button>
          <button class="toolbar-btn" id="export-svg-btn" title="Zapisz wizualizację bloków i siatkę powiązań jako autonomiczny obraz wektorowy (.svg)">
            🖼️ Eksport SVG
          </button>
          <button class="toolbar-btn primary" id="open-config-btn" title="Otwórz panel konfiguracji animacji i suwaków wag DOM">
            ⚙️ Konfigurowalne UI
          </button>
        </div>
      </div>
      <div class="canvas-workspace" id="workspace"></div>
      <svg class="relations-overlay"></svg>
      ${this.renderConfigDrawer()}
    `;

  this.shadowRoot.getElementById('scan-workspace-btn')?.addEventListener('click', () => {
    vscode.postMessage({
      command: 'scanEntireWorkspace',
      payload: { weights: currentUiConfig.weights }
    });
  });
  // Podpięcie przycisków eksportu
  this.shadowRoot.getElementById('export-md-btn')?.addEventListener('click', () => {
    if (!this._ontology) return;
    vscode.postMessage({
      command: 'exportOntologyMarkdown',
      payload: {
        ontology: this._ontology,
        weights: currentUiConfig.weights
      }
    });
  });

  this.shadowRoot.getElementById('export-svg-btn')?.addEventListener('click', () => {
    const svgContent = this.buildStandaloneSvgSnapshot();
    if (!svgContent || !this._ontology) return;
    vscode.postMessage({
      command: 'exportOntologySvg',
      payload: {
        fileName: this._ontology.fileName,
        svgContent
      }
    });
  });

  // Podpięcie przycisków eksportu
  this.shadowRoot?.getElementById('export-md-btn')?.addEventListener('click', () => {
    if (!this._ontology) return;
    vscode.postMessage({
      command: 'exportOntologyMarkdown',
      payload: {
        ontology: this._ontology,
        weights: currentUiConfig.weights
      }
    });
  });

  this.shadowRoot?.getElementById('export-svg-btn')?.addEventListener('click', () => {
    const svgContent = this.buildStandaloneSvgSnapshot();
    if (!svgContent || !this._ontology) return;
    vscode.postMessage({
      command: 'exportOntologySvg',
      payload: {
        fileName: this._ontology.fileName,
        svgContent
      }
    });
  });
}};

// Rejestracja Custom Elements
customElements.define('ontology-node', OntologyNodeElement);
customElements.define('ontology-canvas', OntologyCanvasElement);

// Nasłuchiwanie na wiadomości z procesu głównego VS Code (Extension Host)
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.command === 'updateOntology') {
    const canvas = document.querySelector('ontology-canvas') as OntologyCanvasElement | null;
    if (canvas) {
      canvas.ontology = message.payload;
    }
  }
});