# Umsetzungsplan · Crafting-Panel (Ref-Mix)

Stand: Designphase. **Noch nichts davon ist im Spiel.** Wir designen das Panel hier
fertig und bauen es dann **in einem Durchgang** ein. Neue Designentscheidungen
werden hier ergänzt, ältere Versionen (v2 bis v8) gelten nur noch als Verlauf.

## Zielbilder

| Teil | Referenz (Mockup) | Werte |
|---|---|---|
| Panel, Standardansicht mit Chat | `crafting-panel-ref-mix-v10.png` | `look-v10.css` (v10 = v9 mit Punktmuster; v9 = v8 mit den SVG-Avataren) |
| Lade-Panel beim Craften | `bauplan-silhouette.html` / `.gif` / `-frames.png` | im HTML (Konstanten oben im Script) |
| Avatare | `design/avatars/mitchy.svg`, `player.svg` | Erzeugung: `design/avatars/make-avatars.cjs` |

Nicht mehr aktuell: `bauplan-loading.*` (Maschinen-Variante, nur als Vergleich).

## 1. Panel-Look (`src/ui/ui.css`, Bereich Workshop `.cw3`)

- **Hintergrund:** Eine Ebene über den ganzen Bildschirm, `rgba(28, 28, 26, 0.2)` mit `blur(6px)`. Das Sheet selbst bekommt keine eigene Fläche und keinen Blur.
- **Chat-Rahmen:** Creme `rgba(246, 241, 227, 0.94)`, Radius 24.
  - Darauf ein dezentes Punktraster: hellbraune Punkte `rgba(214, 160, 92, 0.16)`, Ø 9 px, Raster 15 px.
  - Oben am kräftigsten, nach unten mit einem Creme-Verlauf ausgeblendet (0 → 55 % bei 60 % Höhe → 90 % unten).
- **Ecken-Buttons** (Zurück, X, Münzen):
  - dunkles Oliv `rgba(36, 40, 12, 0.7)`, ohne Rand;
  - Icon und Zahl in Creme `#ebe6c8`;
  - Radius 12.
- **Verlauf-Lasche:**
  - Buttergelb `#ffda6e`, Icon Ocker `#c0983f`, ohne Rand;
  - Radius 0 12 12 0;
  - `top: 32px`, sitzt am geraden Teil der Rahmenkante.
- **Chat-Bubbles:**
  - Form: Radius 18, Padding 13 × 22, kein Rand, kein Schatten;
  - Schweif (22 × 18, SVG-Maske) auf Höhe der ersten Zeile, zeigt zum Avatar;
  - Schrift Fredoka, 16 px, Stärke 500.

  | Sprecher | Fläche | Schrift |
  |---|---|---|
  | Mitchy | `#fffdf8` | `#4a3a30` |
  | Spieler | Cyan `#81f1f5` | Petrol `#1f5d66` |

- **Namen unter den Avataren:** warmes Braun `#8b6f5c`.
- **Ergebnis-Karte** (keine Bubble):
  - helles Panel `#fff5ed`, Rand 2 px `#f3ddd5`, Radius 18, ohne Schweif;
  - Bildfläche `#fffdf8`, Radius 14;
  - Name `#4a3a30`, Tag-Rand `#d9c2b8`, Untertext `#8a7166`.
- **Eingabe:**
  - Fläche `#fff5ef`, Rand 2 px `#b9a097`, Radius 16, heller Außenring 4 px `#fffdf8`;
  - Text `#6b5048`, Platzhalter und Zähler `#a88c82`;
  - keine Eckklammern.
- **Craft-Button:** Grün `#8fbe58`, weiße Schrift, Radius 16, Außenring 4 px `#fdffe8`.

## 2. Avatare (`src/ui/Chat.tsx` `Portrait`, `src/CraftModal.tsx`)

- Statt der ASCII-Porträts kommen die Pixel-SVGs aus `design/avatars/` (nach `src/assets/` oder `public/` kopieren).
  - Abgerundetes Quadrat, Radius 22 %, weißer Rand 3 px, kein Schatten.
  - Die Hintergrundfläche ist in der SVG enthalten: Mitchy Pfirsich `#fbc08f`, Spieler Rosa `#fbb7cc`.
- Gezeigt wird nur der Kopf, mittig. Beide Köpfe sind gleich hoch (56 % der Box).
  - Spieler-Pixel 1,2 : 1 wie in der Spielwelt, Mitchy quadratisch.
  - Farben wie die Sprites im Spiel.
- **Offen:** Der Spieler kann im Spiel sein Aussehen ändern. Dann wird die SVG zur Laufzeit aus dem Sprite erzeugt (gleiche Logik wie `make-avatars.cjs`), statt fest zu sein.

## 3. Lade-Panel beim Craften (`src/CraftModal.tsx`, `busy`-Zweig)

- Keine „…“-Bubble mehr darüber. Mitchys Antwort ist direkt die Box.
- Die Box sieht aus wie die Ergebnis-Karte (Abschnitt 1). Darin liegt der Bauplan:
  - **Form:** eine Vektorform wie in der Referenz, also Rollen links und rechts mit runden Köpfen und eingerollten Enden, dazwischen blaues Papier `#3a74e0` mit dunklen Randstreifen `#3467d6`.
  - **Raster:** quadratisch, ohne Maßlinien.
  - **Zeichenfläche:** in der Mitte des Papiers, weißer Rahmen 2 px, Radius 8.
  - **Status:** Text und Prozentzahl in Weiß, Fredoka 600; Balken cyan `#8be9fb`.
- **Ablauf:**
  1. **Umriss:** Die Außenkontur des Objekts wird wie mit einem Stift gezogen. Ein Zeichen erscheint erst, wenn der Stift die Stelle erreicht, also ohne fliegende Zeichen. Dauer etwa 12,8 s. Status: „something is taking shape…“.
  2. **Umriss steht:** Er füllt sich leicht. Status: „there it is…“.
  3. **Asset lädt:** Die Zeilen der fertigen Zeichnung erscheinen im Umriss. Status: „drawing line n“. Das entspricht dem heutigen `partial`.
  4. **Fertig:** Der Plan blendet in etwa 0,8 s aus. In derselben Box blendet die Ergebnis-Karte ein (Bild, Name, Tag, Untertext) und gleitet dabei 8 px nach oben.
- **Offen:** Der Umriss braucht die Außenform des Objekts, bevor die Zeichnung fertig ist. Vorschläge:
  - aus der Referenzskizze (`stage === 'image'`) oder einer ersten groben Maske;
  - bis dahin läuft der Stift als Platzhalter-Kontur.
  - Im Mockup kommt der Umriss aus dem fertigen Ergebnis.

## 4. Schrift

- Fredoka (400, 500, 600) einbinden, für Bubbles, Karten, Status und Buttons.
- ASCII-Zeichnungen und Porträt-Reste behalten die Spielschrift (`--game-font`).

## 5. Umfang und Entscheidungen vor dem Einbau

- **Wirkung auf andere Panels:** Die Klassen `ds-*` nutzen auch andere Panels, zum Beispiel `MitchyTalk` und den Shop. Zu klären ist, ob nur das Crafting-Panel umgestellt wird (Regeln unter `.cw3` bzw. dem Crafting-Overlay) oder alle Dialoge.
- **Varianten:** `/0` sowie die Test-Links `/1`, `/2`, `/3`. Zu klären ist, ob alle oder nur `/0` den neuen Look bekommen. Der Nutzer-Test vergleicht die Varianten.
- **Mobil:** Abstände und Größen aus `specs.md` (≤ 820 / ≤ 480) gegen den neuen Look prüfen.

## Prüfung nach dem Einbau

- `npx tsc --noEmit -p .`
- Dev-Server mit `STUDY_FAKE_AI=1`, Ablauf „a pirate ship“, Screenshots gegen `crafting-panel-ref-mix-v10.png` und `bauplan-silhouette-frames.png` vergleichen.
- Desktop, Tablet und Mobil prüfen.
