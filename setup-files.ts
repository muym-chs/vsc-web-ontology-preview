#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT_DIR = process.cwd();
const FORCE_OVERWRITE = process.argv.includes('--force');

// 1. Definicja wymaganych katalogów projektu
const REQUIRED_DIRS = [
  'src',
  'src/parsers',
  'src/semantic',
  'src/webview',
  'src/exporters',
  'src/workspace',
  'tests',
  'scripts',
  '.vscode'
];

// 2. Mapa plików bazowych i punktów wejściowych (tworzone, jeśli brakuje ich na dysku)
const INITIAL_FILES: Record<string, string> = {
  'src/extension.ts': `import * as vscode from 'vscode';
import { ExtensionHostIntegration } from './extension-host-integration';

export function activate(context: vscode.ExtensionContext) {
  ExtensionHostIntegration.activate(context);
}

export function deactivate() {}
`,

  'src/parsers/types-and-css.ts': `import { OntologyRelation } from '../webview/ontology-viewer';

export interface RawAstNode {
  id: string;
  tagOrComponent: string;
  frameworkOrigin: 'html' | 'twig' | 'react' | 'angular';
  layoutType: 'block' | 'flex' | 'grid' | 'inline';
  cssFrameworkHints: string[];
  rawTextSegments: string[];
  domBoostWeight: number;
  isDynamicContent: boolean;
  attributes: Record<string, string>;
  sourceLine?: number;
  children: RawAstNode[];
}

export interface ParsedDocumentAst {
  fileName: string;
  metadata: Record<string, string>;
  rootNodes: RawAstNode[];
  relations: OntologyRelation[];
}

export interface CustomCssRule {
  name: string;
  pattern: RegExp;
  targetLayout: 'grid' | 'flex' | 'block' | 'inline';
}

export class CssFrameworkClassifier {
  private static layoutRules: CustomCssRule[] = [
    { name: 'standard-grid', pattern: /^(grid|d-grid|row|col-|grid-cols-|gap-)/, targetLayout: 'grid' },
    { name: 'uikit-bulma-drupal-grid', pattern: /^(uk-grid|uk-child-width-|columns|column|layout--[a-z]+col)/, targetLayout: 'grid' },
    { name: 'standard-flex', pattern: /^(d-flex|flex|inline-flex|flex-row|flex-col|justify-|items-)/, targetLayout: 'flex' }
  ];

  private static INLINE_TAGS = new Set(['span', 'a', 'strong', 'em', 'label', 'i', 'b', 'small', 'code']);

  public static registerCustomRule(rule: CustomCssRule): void {
    this.layoutRules.unshift(rule);
  }

  public static classify(tagName: string, classAttr: string = ''): {
    layoutType: 'block' | 'flex' | 'grid' | 'inline';
    hints: string[];
  } {
    const classes = classAttr.split(/\\s+/).filter(Boolean);
    const hints: string[] = [];
    let layoutType: 'block' | 'flex' | 'grid' | 'inline' = this.INLINE_TAGS.has(tagName.toLowerCase())
      ? 'inline'
      : 'block';

    for (const cls of classes) {
      for (const rule of this.layoutRules) {
        if (rule.pattern.test(cls)) {
          if (layoutType !== 'grid') layoutType = rule.targetLayout;
          hints.push(cls);
          break;
        }
      }
    }
    return { layoutType, hints: Array.from(new Set(hints)).slice(0, 4) };
  }

  public static getDomBoostWeight(tagName: string): number {
    const tag = tagName.toLowerCase();
    if (tag === 'title' || tag === 'h1' || tag === 'meta') return 5.0;
    if (tag === 'h2' || tag === 'h3' || tag === 'header' || tag === 'main') return 3.0;
    if (tag === 'article' || tag === 'section' || /^[A-Z]/.test(tagName) || tag.startsWith('twig:')) return 2.5;
    return 1.0;
  }
}
`
};

// Lista wszystkich oczekiwanych modułów architektonicznych w projekcie
const EXPECTED_ARCHITECTURE_FILES = [
  'src/extension.ts',
  'src/extension-host-integration.ts',
  'src/parsers/types-and-css.ts',
  'src/parsers/drupal-sdc-macro-parser.ts',
  'src/parsers/react-jsx-parser.ts',
  'src/semantic/semantic-engine.ts',
  'src/webview/ontology-viewer.ts',
  'src/exporters/ontology-exporter.ts',
  'src/workspace/workspace-scanner.ts',
  'tests/ontology-suite.test.ts'
];

console.log('🚀 [Bun Setup & Diagnostic] Inicjalizacja struktury projektu UI Ontology Visualizer...\n');

// KROK 1: Tworzenie katalogów
for (const dir of REQUIRED_DIRS) {
  const fullPath = join(ROOT_DIR, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    console.log(`📁 Utworzono katalog: ${dir}/`);
  }
}

// KROK 2: Tworzenie brakujących plików startowych (np. src/extension.ts)
for (const [relPath, content] of Object.entries(INITIAL_FILES)) {
  const fullPath = join(ROOT_DIR, relPath);
  if (!existsSync(fullPath) || FORCE_OVERWRITE) {
    writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Utworzono plik bazowy: ${relPath}`);
  }
}

// KROK 3: Sprawdzenie obecności wszystkich 10 modułów architektury
console.log('\n🔍 [1/3] Audyt plików modułowych w src/ i tests/:');
const missingArchitectureFiles: string[] = [];
for (const expectedFile of EXPECTED_ARCHITECTURE_FILES) {
  const exists = existsSync(join(ROOT_DIR, expectedFile));
  if (exists) {
    console.log(`   ✔ ${expectedFile}`);
  } else {
    console.log(`   ⚠ BRAK PLIKU: ${expectedFile}`);
    missingArchitectureFiles.push(expectedFile);
  }
}

// KROK 4: Skanowanie wszystkich plików .ts za pomocą natywnego Bun.Transpiler pod kątem brakujących importów
console.log('\n🔍 [2/3] Walidacja drzewa importów AST (Bun.Transpiler):');

const transpiler = new Bun.Transpiler({ loader: 'ts' });
const allTsFiles: string[] = [];

function collectTsFiles(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectTsFiles(full);
    else if (full.endsWith('.ts')) allTsFiles.push(full);
  }
}

collectTsFiles(join(ROOT_DIR, 'src'));
collectTsFiles(join(ROOT_DIR, 'tests'));

const brokenRelativeImports: Array<{ sourceFile: string; importPath: string }> = [];
const externalPackagesUsed = new Set<string>();
const BUILTIN_IGNORE = new Set([
  'vscode',
  'fs',
  'path',
  'node:fs',
  'node:path',
  'bun:test'
]);

for (const tsFile of allTsFiles) {
  const code = readFileSync(tsFile, 'utf8');
  const imports = transpiler.scanImports(code);

  for (const imp of imports) {
    const spec = imp.path;
    if (spec.startsWith('.')) {
      // Sprawdź czy docelowy plik lokalny istnieje (.ts, .js lub /index.ts)
      const resolvedBase = resolve(dirname(tsFile), spec);
      const candidates = [
        `${resolvedBase}.ts`,
        `${resolvedBase}.tsx`,
        `${resolvedBase}/index.ts`,
        resolvedBase
      ];
      const found = candidates.some((c) => existsSync(c));
      if (!found) {
        brokenRelativeImports.push({
          sourceFile: tsFile.replace(`${ROOT_DIR}/`, ''),
          importPath: spec
        });
      }
    } else if (!BUILTIN_IGNORE.has(spec)) {
      // Wyodrębnij nazwę pakietu npm (obsługa scoped packages np. @babel/parser)
      const pkgName = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      externalPackagesUsed.add(pkgName);
    }
  }
}

if (brokenRelativeImports.length === 0) {
  console.log('   ✔ Wszystkie lokalne ścieżki importów (./ i ../) są spójne!');
} else {
  for (const broken of brokenRelativeImports) {
    console.log(`   ❌ Nierozwiązany import w ${broken.sourceFile} -> "${broken.importPath}"`);
  }
}

// KROK 5: Weryfikacja zależności w package.json
console.log('\n🔍 [3/3] Weryfikacja pakietów zewnętrznych w package.json:');
const pkgJsonPath = join(ROOT_DIR, 'package.json');

if (existsSync(pkgJsonPath)) {
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const installedDeps = new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.devDependencies || {})
  ]);

  const missingNpmPackages: string[] = [];
  for (const extPkg of externalPackagesUsed) {
    if (!installedDeps.has(extPkg)) {
      missingNpmPackages.push(extPkg);
    }
  }

  if (missingNpmPackages.length === 0) {
    console.log('   ✔ Wszystkie wymagane biblioteki AST są obecne w package.json!');
  } else {
    console.log(`   ⚠ Brakujące pakiety w package.json: ${missingNpmPackages.join(', ')}`);
    console.log(`   👉 Zainstaluj je jednym poleceniem w Bun:`);
    console.log(`      bun add ${missingNpmPackages.join(' ')}`);
    console.log(`      bun add -d @types/babel__traverse`);
  }
} else {
  console.log('   ⚠ Nie znaleziono pliku package.json w katalogu głównym.');
}

console.log('\n==============================================================');
if (missingArchitectureFiles.length === 0 && brokenRelativeImports.length === 0) {
  console.log('🎉 Struktura projektu jest kompletna! Możesz uruchomić: bun run compile');
} else {
  console.log('ℹ Uzupełnij brakujące pliki powyżej, a następnie uruchom: bun run compile');
}
console.log('==============================================================');