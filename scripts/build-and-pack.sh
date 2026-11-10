#!/usr/bin/env bash
set -e

echo "=== [1/4] Czyszczenie starej kompilacji (dist/) ==="
rm -rf dist *.vsix

echo "=== [2/4] Instalacja zależności przez Bun ==="
bun install

echo "=== [3/4] Kompilacja Extension Host oraz Webview (Bun + esbuild) ==="
bun run compile

echo "=== [4/4] Generowanie paczki .vsix (bunx) ==="
bunx vsce package

echo "=================================================="
echo "Sukces! Paczka .vsix została wygenerowana przy użyciu Bun."
echo "=================================================="