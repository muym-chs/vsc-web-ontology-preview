import * as vscode from 'vscode';
import { ExtensionHostIntegration } from './extension-host-integration';

export function activate(context: vscode.ExtensionContext) {
  ExtensionHostIntegration.activate(context);
}

export function deactivate() {}