import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EnhancedTwigAndAngularParser, SdcYamlSchemaMetadata } from './parsers/drupal-sdc-macro-parser';
import { ReactJsxParser } from './parsers/react-jsx-parser';
import { SemanticMetricsEngine } from './semantic/semantic-engine';
import { DocumentOntology } from './webview/ontology-viewer';
import { CssFrameworkClassifier } from './parsers/types-and-css';
import { OntologyMarkdownExporter } from './exporters/ontology-exporter';
import { WorkspaceOntologyScanner } from './workspace/workspace-scanner';

export class ExtensionHostIntegration {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private static parserTwigAngular = new EnhancedTwigAndAngularParser();
  private static parserReact = new ReactJsxParser();
  private static changeTimeout: NodeJS.Timeout | undefined;
  public publicLiveWeights: any;
  public static activate(context: vscode.ExtensionContext) {
    let disposableCommand = vscode.commands.registerCommand('uiOntology.openPreview', () => {
      this.createOrShowPreview(context);
    });

    let disposableConfigCommand = vscode.commands.registerCommand('uiOntology.openUiConfig', () => {
      if (this.currentPanel) {
        this.currentPanel.webview.postMessage({ command: 'toggleConfigDrawer' });
      }
    });

    context.subscriptions.push(disposableCommand, disposableConfigCommand);

    // Nasłuchiwanie zmian w aktywnie edytowanym dokumencie (Live-Reload)
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (this.currentPanel && event.document === vscode.window.activeTextEditor?.document) {
        if (this.changeTimeout) clearTimeout(this.changeTimeout);
        this.changeTimeout = setTimeout(() => {
          this.parseAndSendActiveDocument();
        }, 300); // 300ms debounce
      }
    });

    // Nasłuchiwanie zmiany aktywnego edytora lub pozycji kursora
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (this.currentPanel) {
        this.parseAndSendActiveDocument();
      }
    });

    // Odczyt zapisanego stanu konfiguracji UI z przestrzeni roboczej
    const savedConfig = context.workspaceState.get('uiOntologyConfig');
    if (savedConfig && this.currentPanel) {
      this.currentPanel.webview.postMessage({ command: 'updateUiConfig', payload: savedConfig });
    }

    this.currentPanel?.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'revealNodeInEditor': {
          if (message.tagOrComponent && /\.(twig|jsx|tsx|html)$/.test(message.tagOrComponent)) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceFolder) {
              const targetUri = vscode.Uri.file(path.join(workspaceFolder, message.tagOrComponent));
              const doc = await vscode.workspace.openTextDocument(targetUri);
              await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            }
          } else {
            this.jumpToEditorLine(message.nodeLine);
          }
          break;
        }

        case 'liveUpdateWeights':
          // Natychmiastowe przeliczenie AST i TF-IDF z nowymi wartościami z suwaków
          this.activeLiveWeights = message.payload;
          this.parseAndSendActiveDocument();
          break;
        case 'saveUiConfig':
          this.activeLiveWeights = message.payload.weights;
          await context.workspaceState.update('uiOntologyConfig', message.payload);
          // Równoczesna aktualizacja ustawień projektu .vscode/settings.json
          const vsConfig = vscode.workspace.getConfiguration('uiOntology');
          await vsConfig.update('charsPerSkeletonLine', message.payload.weights.charsPerLine, vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage('Zapisano wagi DOM, próg linii oraz animacje UI.');
          break;
        
        case 'exportOntologyMarkdown': {
          const { ontology, weights } = message.payload;
          const markdownContent = OntologyMarkdownExporter.generateMarkdownReport(ontology, weights);
          const defaultUri = vscode.Uri.file(
            path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
              `${ontology.fileName}.ontology.md`
            )
          );

          const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'Markdown & Mermaid Report': ['md'] },
            saveLabel: 'Zapisz Raport Ontologii (.md)'
          });

          if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdownContent, 'utf8'));
            const openDoc = await vscode.workspace.openTextDocument(saveUri);
            await vscode.window.showTextDocument(openDoc, vscode.ViewColumn.Beside);
            vscode.window.showInformationMessage(`Zapisano raport ontologii: ${path.basename(saveUri.fsPath)}`);
          }
          break;
        }

        case 'exportOntologySvg': {
          const { fileName, svgContent } = message.payload;
          const defaultUri = vscode.Uri.file(
            path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
              `${fileName}.ontology.svg`
            )
          );

          const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'SVG Vector Image': ['svg'] },
            saveLabel: 'Zapisz Obraz SVG (.svg)'
          });

          if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(svgContent, 'utf8'));
            vscode.window.showInformationMessage(`Zapisano zrzut wektorowy SVG: ${path.basename(saveUri.fsPath)}`);
          }
          break;
        }
        case 'scanEntireWorkspace': {
          this.activeLiveWeights = message.payload?.weights || this.activeLiveWeights;
          await this.runWorkspaceScan();
          break;
        }
      }
    });
  }

  public static createOrShowPreview(context: vscode.ExtensionContext) {
    const column = vscode.ViewColumn.Beside;

    if (this.currentPanel) {
      this.currentPanel.reveal(column);
      this.parseAndSendActiveDocument();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'uiOntologyPreview',
      'UI Ontology & Block Visualizer',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
      }
    );

    this.currentPanel = panel;

    this.currentPanel.onDidDispose(() => {
      this.currentPanel = undefined;
    });

    // Obsługa wiadomości przychodzących z Webview do Extension Host
    this.currentPanel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'revealNodeInEditor') {
        this.jumpToEditorLine(message.nodeLine);
      }
    });

    const scanWorkspaceCmd = vscode.commands.registerCommand('uiOntology.scanWorkspace', async () => {
      this.createOrShowPreview(context);
      await this.runWorkspaceScan();
    });
    context.subscriptions.push(scanWorkspaceCmd);

    this.parseAndSendActiveDocument();
  }

  // Metoda uruchamiająca skanowanie z paskiem postępu VS Code:
  private static async runWorkspaceScan() {
    if (!this.currentPanel) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'UI Ontology Visualizer: Skanowanie komponentów w Workspace...',
        cancellable: false
      },
      async (progress) => {
        const globalOntology = await WorkspaceOntologyScanner.scanWorkspace(
          this.activeLiveWeights,
          progress
        );

        this.currentPanel?.webview.postMessage({
          command: 'updateOntology',
          payload: globalOntology
        });
      }
    );
  }

  private static parseAndSendActiveDocument() {
    const vsConfig = vscode.workspace.getConfiguration('uiOntology');
    const customGridPattern = vsConfig.get<string>('customCssGridRegex');
    if (customGridPattern) {
      CssFrameworkClassifier.registerCustomRule({
        name: 'user-settings-grid',
        pattern: new RegExp(customGridPattern),
        targetLayout: 'grid'
      });
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.currentPanel) return;

    const document = editor.document;
    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);
    const sourceCode = document.getText();

    // Szukanie opcjonalnego pliku SDC *.component.yml w tym samym katalogu (np. card.html.twig -> card.component.yml)
    const sdcYamlSchema = this.tryLoadSdcYamlSchema(filePath);

    let rawAst;
    if (fileName.endsWith('.jsx') || fileName.endsWith('.tsx')) {
      rawAst = this.parserReact.parse(sourceCode, fileName);
    } else {
      rawAst = this.parserTwigAngular.parse(sourceCode, fileName, sdcYamlSchema);
    }

    const documentOntology: DocumentOntology = SemanticMetricsEngine.process(rawAst);

    this.currentPanel.webview.postMessage({
      command: 'updateOntology',
      payload: documentOntology
    });
  }

  private static tryLoadSdcYamlSchema(twigFilePath: string): SdcYamlSchemaMetadata | undefined {
    try {
      const dir = path.dirname(twigFilePath);
      const baseName = path.basename(twigFilePath, path.extname(twigFilePath)).replace(/\.html$/, '');
      const ymlPath = path.join(dir, `${baseName}.component.yml`);

      if (fs.existsSync(ymlPath)) {
        const content = fs.readFileSync(ymlPath, 'utf8');
        // Bardzo lekki parser YAML dla SDC (lub użycie js-yaml w produkcji)
        const nameMatch = content.match(/^name:\s*(['"]?)([^'"\n]+)\1/m);
        const descMatch = content.match(/^description:\s*(['"]?)([^'"\n]+)\1/m);
        return {
          name: nameMatch ? nameMatch.get(2) : baseName,
          description: descMatch ? descMatch.get(2) : undefined
        };
      }
    } catch {
      // Ignory błędy odczytu plików YAML
    }
    return undefined;
  }
  
  private static jumpToEditorLine(targetLine?: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !targetLine) return;

    const line = Math.max(0, targetLine - 1);
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}