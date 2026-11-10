ADR-001: Dwufazowa statyczna normalizacja AST z pre-procesorem syntetycznych tagów XML/HTML

    Status: Zaakceptowane

    Kontekst: Wtyczka musi analizować w czasie rzeczywistym (podczas edycji kodu z debounce ~300 ms) pliki z diametralnie różnych ekosystemów: szablony serwerowe Twig (w tym Drupal Single Directory Components i makra), szablony Angular 17+ (@for, @if, @defer), komponenty React (.jsx/.tsx) oraz czysty HTML. Uruchamianie właściwych kompilatorów (PHP Twig Engine, Angular Compiler CLI, Babel Runtime) wymagałoby skonfigurowanego środowiska uruchomieniowego po stronie użytkownika i załamywałoby się przy każdym niedomkniętym nawiasie.

    Decyzja: Zastosowano dwufazową analizę statyczną Fault-Tolerant:

        Dla języków szablonowych (Twig/Drupal/Angular 17+) warstwa pre-procesora (w tym Balanced-Brace Tokenizer dla bloków @if/@for) zamienia instrukcje sterujące na syntetyczne węzły DOM (<sdc:embed>, <sdc:slot>, <twig:macro>, <ng:for>), które następnie są strumieniowo parsowane przez odporny na błędy htmlparser2.

        Dla plików .jsx/.tsx użyto @babel/parser z flagą errorRecovery: true.
        Oba potoki generują identyczną strukturę pośrednią ParsedDocumentAst.

    Konsekwencje: Zerowa zależność od zewnętrznego środowiska (PHP/Node.js projektu docelowego), czas parsowania pojedynczego pliku poniżej 15 ms, pełna ciągłość wizualizacji nawet w trakcie pisania niekompletnego kodu.

ADR-002: Heurystyczna klasyfikacja układu CSS zamiast budowania pełnego drzewa CSSOM

    Status: Zaakceptowane

    Kontekst: Wizualizacja ma prezentować architekturę komponentów blokowych, siatek (grid) i kontenerów elastycznych (flex) bez renderowania widoku 1:1. Parsowanie zewnętrznych arkuszy SCSS/PostCSS oraz rozwiązywanie kaskady CSS w locie drastycznie obniżyłoby wydajność Extension Host.

    Decyzja: Wprowadzono deterministyczny klasyfikator tokenów klas (CssFrameworkClassifier), który rozpoznaje wzorce z najpopularniejszych frameworków (Tailwind, Bootstrap, BEM) oraz wyciąga dynamiczne klasy z konstrukcji Drupala ({% set classes = [...] %} + attributes.addClass()).

    Konsekwencje: Natychmiastowe rozpoznawanie roli kontenera (block | flex | grid | inline) bezpośrednio z kodu szablonu; brak narzutu I/O na skanowanie katalogu node_modules czy skompilowanych plików CSS.

ADR-003: Hybrydowy model semantyczny TF-IDF wzmocniony wagami strukturalnymi DOM (DOM-Boosted TF-IDF)

    Status: Zaakceptowane

    Kontekst: Klasyczny algorytm TF-IDF traktuje dokument jako płaski worek słów (Bag-of-Words), przez co techniczne lub powtarzalne słowa w stopkach i listach mogłyby zdominować główny koncept komponentu.

    Decyzja: Zaprojektowano dwuwymiarowy wskaźnik słów dla każdego bloku i całego dokumentu:

        Most Frequent Word (TF): Najczęściej występujące słowo po odfiltrowaniu stop-words (PL/EN) oraz słów kluczowych języka.

        Most Significant Word (DOM-Boosted TF-IDF): Waga słowa jest mnożona przez współczynnik rangi węzła (domBoostWeight od 1.0x dla <p> do 5.0x dla <h1>/<title>, 4.0x dla pól field_title i 3.5x dla komponentów Drupal SDC).

    Konsekwencje: Odznaki 🎯 Most Significant na blokach precyzyjnie wskazują domenowe znaczenie komponentu (np. nazwa encji Drupala, główny temat sekcji lub kluczowy slot SDC), natomiast puste linie tekstu (Skeleton Lines) odzwierciedlają szacowaną objętość treści bez szumu wizualnego.

ADR-004: Natywne Web Components (Shadow DOM) + nakładka SVG w VS Code Webview

    Status: Zaakceptowane

    Kontekst: Widok Webview w VS Code działa w odizolowanym iframe z rygorystycznym Content-Security-Policy. Zastosowanie ciężkiego frameworka (np. pełnego Reacta z biblioteką grafową Canvas/WebGL) utrudniałoby odwzorowanie zagnieżdżonego układu Flex/Grid z jednoczesnym rysowaniem krawędzi powiązań między dowolnie zagnieżdżonymi węzłami.

    Decyzja: Wykorzystano natywne Custom Elements (<ontology-canvas>, <ontology-node>) z Shadow DOM i natywnymi elementami <slot> do odwzorowania hierarchii parent-child, a relacje nieliniowe (twig-include, prop-binding, semantic-similarity) narysowano na przezroczystej warstwie <svg> pozycjonowanej absolutnie nad drzewem DOM i aktualizowanej przez ResizeObserver.

    Konsekwencje: Paczka webview.js waży poniżej 15 KB, natychmiastowo dziedziczy zmienne motywów VS Code (--vscode-*) i pozwala na płynne łączenie układu blokowego z wykresem powiązań.