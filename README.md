## ⚡ Dlaczego używamy Bun zamiast npm?

W projekcie **UI Ontology Visualizer** całkowicie zrezygnowaliśmy z tradycyjnego `npm` na rzecz **Bun** jako środowiska wykonawczego i menedżera pakietów. Przejście to przynosi wymierne korzyści inżynieryjne:

### 1. Ekstremalna wydajność instalacji (Speed)
* **Błyskawiczne pobieranie i linkowanie:** Bun jest napisany w języku Zig i zoptymalizowany pod kątem maksymalnej przepustowości operacji I/O. Instalacja zależności (`bun install`) potrafi być nawet do **20-30 razy szybsza** niż standardowe `npm install`, co drastycznie skraca czas budowania kontenerów CI/CD oraz przygotowania środowiska deweloperskiego.

### 2. Globalny cache i oszczędność dysku
* Podobnie do pnpm, Bun wykorzystuje zaawansowany globalny magazyn cache z mechanizmem twardych dowiązań (*hard links*). Pliki `node_modules` nie są wielokrotnie kopiowane dla każdego projektu, co oszczędza gigabajty miejsca na dysku i eliminuje narzut na operacje dyskowe.

### 3. Natywne wsparcie dla TypeScript bez konfiguracji
* Bun posiada wbudowany, ultrafzybki transpiler obsługujący pliki `.ts`, `.tsx`, `.jsx` oraz `.js` natywnie. Nie wymaga to instalowania dodatkowych pakietów typu `ts-node`, `tsc` czy konfiguracji skomplikowanych mapowań w locie w prostych skryptach pomocniczych.

### 4. Ekosystem All-in-One i pełna kompatybilność z Node.js
* **Drop-in replacement:** Bun w pełni obsługuje standardowe pliki `package.json`, skrypty npm oraz strukturę modułów Node.js. Przejście z `npm run` na `bun run` nie wymaga modyfikacji kodu źródłowego ani struktury API wtyczek VS Code.
* **Wbudowane narzędzia:** Bun dostarcza gotowy, niezwykle szybki test runner oraz bundler, co w przyszłości pozwala uprościć łańcuch narzędzi (*toolchain*) bez konieczności polegania na zewnętrznych paczkach deweloperskich.

### 5. Płynna integracja z CLI i narzędziami VS Code (`bunx`)
* Zamiast komend `npx`, Bun dostarcza `bunx`, które uruchamia pakiety (takie jak `@vscode/vsce` do budowania paczek `.vsix`) bezpośrednio z lokalnego cache lub pobiera je w ułamku sekundy bez konieczności trwałych instalacji globalnych.# vsc-web-ontology-preview
