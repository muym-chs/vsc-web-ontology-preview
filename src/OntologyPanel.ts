import * as vscode from 'vscode';
import { DocumentOntology } from './webview/ontology-viewer';

export class OntologyPanel {
  public static currentPanel: OntologyPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Obsługa zdarzeń kliknięcia w węzeł z poziomu Webview
    this._panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'revealNodeInEditor') {
        vscode.window.showInformationMessage(`Wybrano węzeł ontologii: ${message.nodeId}`);
      }
    });

    this._panel.onDidDispose(() => {
      OntologyPanel.currentPanel = undefined;
    });
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;

    if (OntologyPanel.currentPanel) {
      OntologyPanel.currentPanel._panel.reveal(column);
      return OntologyPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'uiOntologyPreview',
      'UI Ontology & Block Visualizer',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
      }
    );

    OntologyPanel.currentPanel = new OntologyPanel(panel, extensionUri);
    return OntologyPanel.currentPanel;
  }

  public update(ontologyData: DocumentOntology) {
    this._panel.webview.postMessage({
      command: 'updateOntology',
      payload: ontologyData
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="pl">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>UI Ontology Visualizer</title>
        <style>
          body {
            padding: 0;
            margin: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
        </style>
      </head>
      <body>
        <ontology-canvas></ontology-canvas>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// const samplePayload: DocumentOntology = {
//   fileName: 'node--article--full.html.twig',
//   globalMetrics: {
//     totalBlocks: 4,
//     globalMostFrequent: { word: 'architektura', count: 12 },
//     globalMostSignificant: { word: 'mikroserwisy', score: 38.4 }
//   },
//   rootNodes: [
//     {
//       id: 'node-1',
//       tagOrComponent: 'article',
//       frameworkOrigin: 'twig',
//       layoutType: 'block',
//       cssFrameworkHints: ['max-w-4xl', 'mx-auto'],
//       metrics: {
//         estimatedTextLines: 0,
//         isDynamicContent: false,
//         mostFrequentWord: null,
//         mostSignificantWord: { word: 'mikroserwisy', score: 38.4 }
//       },
//       children: [
//         {
//           id: 'node-2',
//           tagOrComponent: 'twig:block:header',
//           frameworkOrigin: 'twig',
//           layoutType: 'flex',
//           cssFrameworkHints: ['flex', 'justify-between', 'items-center'],
//           metrics: {
//             estimatedTextLines: 2,
//             isDynamicContent: true,
//             mostFrequentWord: { word: 'tytuł', count: 3 },
//             mostSignificantWord: { word: 'mikroserwisy', score: 25.0 }
//           },
//           children: []
//         },
//         {
//           id: 'node-3',
//           tagOrComponent: 'section.content-body',
//           frameworkOrigin: 'html',
//           layoutType: 'grid',
//           cssFrameworkHints: ['grid', 'grid-cols-2', 'gap-4'],
//           metrics: {
//             estimatedTextLines: 8,
//             isDynamicContent: true,
//             mostFrequentWord: { word: 'architektura', count: 9 },
//             mostSignificantWord: { word: 'konteneryzacja', score: 19.2 }
//           },
//           children: []
//         }
//       ]
//     }
//   ],
//   relations: [
//     {
//       fromId: 'node-2',
//       toId: 'node-3',
//       type: 'semantic-similarity',
//       label: 'shared: {{ node.title }}'
//     }
//   ]
// };