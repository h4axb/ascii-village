# Umsetzungsplan · Crafting-Panel, neue Version (Ref-Mix)

**Version 2 · Stand: Panel v13 + Lade-Bauplan (Silhouette).** Noch nichts davon ist im Spiel.

Das Crafting-Panel wird als **neue Version neben den bestehenden** gebaut, in einem Durchgang:
- `/0` bis `/3` und die Nutzertests bleiben unverändert.
- Die neue Version bekommt einen eigenen Schalter, die Empfehlung ist ein eigener Link (siehe Abschnitt 6).
- Was danach am Design noch geändert wird, kommt hier hinein und wird mitgebaut.

## Zielbilder (Referenz für den Einbau)

| Teil | Mockup | Werte / Quelle |
|---|---|---|
| Panel mit Chat | `crafting-panel-ref-mix-v13.png` | `look-v12.css`, dazu die Icons aus `design/icons/` |
| Lade-Panel | `bauplan-silhouette.html` / `.gif` / `.mp4` / `-frames.png` | Konstanten oben im Script des HTML |
| Avatare | `design/avatars/mitchy.svg`, `player.svg` | Erzeugung: `design/avatars/make-avatars.cjs` |
| Icons | `design/icons/hammer.svg`, `design/icons/coin.svg` | Hammer 26 px, Münze 22 px |
| **Styleguide** (alle Maße auf einem Sheet) | `styleguide-crafting-v13.png` | Quelle `styleguide-crafting-v13.html`; Farbnamen dort (Teil C) gelten für Figma und Code |

Nur noch Verlauf: v2 bis v12 sowie `bauplan-loading.*` (Maschinen-Variante).

---

## 1. Panel-Look

Alle Regeln gelten nur für die neue Version, etwa unter einer eigenen Klasse wie `.cw3.is-v2` bzw. dem Overlay der neuen Version. So bleiben die gemeinsamen `ds-*`-Bausteine für Shop, `MitchyTalk` und die alten Varianten unverändert. Ort: `src/ui/ui.css` (Bereich Workshop).

**Hintergrund und Rahmen**
- **Hintergrund:** eine Ebene über den ganzen Bildschirm, `rgba(28, 28, 26, 0.2)` mit `blur(6px)`. Das Sheet bekommt keine eigene Fläche und keinen Blur.
- **Chat-Rahmen:**
  - Creme `rgba(246, 241, 227, 0.94)`, Radius 24, weiße Kontur 2 px.
  - Punktraster: Punkte `rgba(214, 160, 92, 0.16)`, Ø 9 px, Raster 15 px.
  - Darüber ein Creme-Verlauf, der die Punkte nach unten ausblendet: 0 % oben, 55 % bei 60 % Höhe, 90 % unten.

**Ecken-Buttons und Lasche**
- **Zurück, X, Münzen:**
  - Buttergelb `#ffda6e`, weiße Kontur 2 px, Radius 12;
  - Icons Ocker `#c0983f`, Münzzahl `#8a6a24`;
  - Größen und Abstände wie heute.
- **Verlauf-Lasche:**
  - `#ffda6e`, Icon `#c0983f`, ohne Rand;
  - Radius 0 12 12 0;
  - `top: 32px`, am geraden Teil der Rahmenkante.

**Chat**
- **Bubbles:**
  - Radius 18, Padding 13 × 22, kein Rand, kein Schatten;
  - Fredoka 16 px, Stärke 500;
  - Schweif 22 × 18 als SVG-Maske, Pfad `M22 0 H4.2 C1.6 0 0.4 2.6 2.2 4.4 L15 17 C17.5 19 22 18 22 14 Z`;
  - Schweif oben auf 16 px, ragt 18 px über und zeigt zum Avatar; beim Spieler gespiegelt.

  | Sprecher | Fläche | Schrift |
  |---|---|---|
  | Mitchy | `#fffdf8` | `#4a3a30` |
  | Spieler | Cyan `#81f1f5` | Petrol `#1f5d66` |

- **Namen unter den Avataren:** `#8b6f5c`.
- **Ergebnis-Karte** (keine Bubble, kein Schweif):
  - Fläche `#fff5ed`, Rand 2 px `#f3ddd5`, Radius 18, Padding 14 × 16;
  - Bildfläche `#fffdf8`, Rand `#f3ddd5`, Radius 14;
  - Name `#4a3a30`, Tag mit Rand `#d9c2b8`, Untertext `#8a7166`.

**Eingabe und Craft-Button**
- **Eingabe:**
  - Fläche `#fff5ef`, Rand 2 px `#b9a097`, Radius 16, Außenring 4 px `#fffdf8`;
  - Text `#6b5048`, Platzhalter und Zähler `#a88c82`;
  - keine Eckklammern.
- **Craft-Button:**
  - Grün `#8fbe58`, weiße Schrift, Radius 16, Außenring 4 px `#fdffe8`;
  - inaktiv mit 45 % Deckkraft wie heute.

**Icons**
- Hammer im Craft-Button: `design/icons/hammer.svg` (26 px) statt des Inline-SVGs in `CraftModal.tsx`.
- Münze in der Münzanzeige: `design/icons/coin.svg` (22 px) statt der Pixel-Münze `ds-coin-icon`.

## 2. Avatare

Ort: `src/ui/Chat.tsx` `Portrait`, `src/CraftModal.tsx` (`mitchySpeaker`).

- Pixel-SVGs statt ASCII-Porträts (aus `design/avatars/` nach `src/assets/`).
- Box: abgerundetes Quadrat, Radius 22 %, weißer Rand 3 px, kein Schatten. Die Hintergrundfläche steckt in der SVG: Mitchy `#fbc08f`, Spieler `#fbb7cc`.
- Nur der Kopf, mittig. Beide Köpfe sind gleich hoch (56 % der Box).
  - **Mitchy:** Ohren bis Kinn (Gesichtszeilen), quadratische Pixel.
  - **Spieler:** Hut bis Kinn plus zwei Zeilen; in diesen beiden Zeilen nur die roten Haarspitzen, ohne Hals und Kragen. Pixel 1,2 : 1 wie in der Spielwelt.
  - Farben wie die Sprites im Spiel.
- **Laufzeit:** Weil der Spieler sein Aussehen ändern kann, wird die Spieler-SVG im Spiel aus dem aktuellen Sprite erzeugt. Die Logik von `make-avatars.cjs` wandert als Funktion nach `src/ui/`. Mitchy folgt seinem Look (`onMitchyLook`).

## 3. Lade-Panel beim Craften (Bauplan)

Ort: `src/CraftModal.tsx`, `busy`-Zweig. Neue Komponente `src/ui/Blueprint.tsx`, Regeln in `ui.css`.

**Box und Plan**
- Keine „…“-Bubble. Mitchys Antwort ist direkt die Box.
- **Box:** wie die Ergebnis-Karte (`#fff5ed`, Rand 2 px `#f3ddd5`, Radius 18), 434 × 326, Innenabstand 14.
- **Plan:** eine Vektorform, Inline-SVG mit `viewBox="105 120 1215 845"`, auf 0,873 skaliert. Formen wie in `bauplan-silhouette.html`:
  - **Linke Rolle:** Zylinder mit Verlauf `#7fc0fb` → `#5a9ff5`, darunter die Einrollung `#3463cb`; die Rolle läuft im Bogen in die Einrollung.
  - **Rechte Rolle:** zwei flache Töne, `#7abbfa` links und `#5a9bf4` rechts. Darunter liegt die Einrollung als Ellipse (`cx 1221, cy 885, rx 101, ry 80`, `#3566cf`) mit dunklem Kern `#2c55b5`. Der Kern reicht bis an den linken und unteren Rand, der hellere Rand ist nur oben rechts zu sehen.
  - **Papier:** `#3a74e0` mit Randstreifen `#3467d6`, die unter beide Rollen laufen. Die Unterkante ist bis unter die Einrollung durchgehend.
  - **Raster:** quadratisch, weiß mit 9 % Deckkraft, 33 Einheiten Abstand, ohne Maßlinien.
- **Zeichenfläche:** in der Mitte des Papiers, 296 × 168, weißer Rahmen 2 px, Radius 8, leichter weißer Außenschein. Darin die ASCII-Zeichnung, gleiche Zellen wie heute: Zeichen auf dunklerem Grund der eigenen Farbe.
- **Status unter der Zeichenfläche:**
  - Text und Prozentzahl in Weiß, Fredoka 600, 16 px;
  - Balken 7 px, Spur weiß 22 %, Füllung `#8be9fb`.

**Ablauf** (ein Tick = 0,1 s; die Werte sind die Konstanten im Mockup)

| Phase | Ticks | Was passiert | Status |
|---|---|---|---|
| 1. Papier | 0 – 12 | Raster baut sich auf | „sketching the blueprint…“ |
| 2. Umriss | 12 – 140 (`T0`–`T1`, ≈ 12,8 s) | Außenkontur wird wie mit einem Stift gezogen | „something is taking shape…“ |
| 3. Umriss steht | bis 154 (`SHIP_START`) | Form füllt sich leicht | „there it is…“ |
| 4. Asset lädt | 2 Ticks je Zeile (`SHIP_STEP`), danach 25 Ticks Halt (`HOLD`) | Zeilen der Zeichnung erscheinen im Umriss | „drawing line n“, am Ende „almost done ✦“ |
| 5. Ergebnis | `FADE` 8 Ticks | Plan blendet aus; in derselben Box blendet die Ergebnis-Karte ein (Bild, Name, Tag, Untertext) und gleitet 8 px nach oben | – |

Details zu den Phasen:
- **Phase 2:**
  - Reihenfolge der Linie: beginnt an der untersten linken Randzelle, dann immer die nächste noch nicht gezeichnete; bei Lücken springt sie zum nächsten Teil.
  - Ein Zeichen erscheint erst, wenn der Stift die Stelle erreicht, ohne fliegende Zeichen.
  - Linie weiß auf `#6a9ef3`, zwei Zellen breit; Stiftspitze `●` auf `#9fdcfb`.
- **Phase 3:** Füllung `#4179e5`, nach 4 Ticks `#4a82ea`.
- **Phase 4:** entspricht dem heutigen `partial`.

Ein Fortschrittsbalken läuft über die Phasen 1 bis 4.

**Umriss im Spiel**
- Die Außenform steht erst fest, wenn die Zeichnung fertig ist. Vorgehen in der neuen Version:
  - Bis das Ergebnis da ist, laufen Papier und eine ruhige Platzhalter-Kontur.
  - Sobald das Ergebnis da ist, wird sein echter Umriss gezogen, dann lädt das Asset.
- Damit die Wartezeit nicht unnötig wächst, wird Phase 2 im Spiel auf die Restzeit angepasst: höchstens 12,8 s, aber nicht länger, als die KI noch braucht. Im Mockup läuft sie immer voll.

## 4. Schrift

- Fredoka 400, 500 und 600 lokal einbinden (Datei in `src/assets/fonts/`, wie die Spielschrift in `src/font.ts`). Verwendet für Bubbles, Karten, Status und Buttons der neuen Version.
- ASCII-Zeichnungen behalten die Spielschrift (`--game-font`).

## 5. Bauschritte (Reihenfolge)

1. Schalter für die neue Version (Abschnitt 6) und die Klasse am Panel-Wurzelelement.
2. Fredoka einbinden.
3. Panel-Look in `ui.css` unter der neuen Klasse (Abschnitt 1).
4. Icons Hammer und Münze.
5. Avatare: Erzeugung aus dem Sprite, `Portrait` für die neue Version.
6. Ergebnis-Karte ohne Bubble-Optik.
7. Lade-Bauplan: `Blueprint.tsx` mit Plan-SVG, Umriss-Pfad, Phasen und Übergang zur Ergebnis-Karte.
8. Mobil: Abstände und Größen aus `specs.md` (≤ 820 / ≤ 480) gegen den neuen Look prüfen und anpassen.
9. Prüfung (unten), dann Commit und Push.

## 6. Neue Version: wo sie läuft

- **Empfehlung:** ein eigener Link `/4` (und `/intro/4`) mit eigenem Spielstand, wie `/1` bis `/3` in `src/App.tsx`. So bleiben die laufenden Nutzertests unberührt.
- **Alternativ:** Wenn die neue Version `/0` ersetzen soll oder als Einstellung umschaltbar sein soll, ändert sich nur Schritt 1.

## Prüfung nach dem Einbau

- `npx tsc --noEmit -p .`
- Dev-Server mit `STUDY_FAKE_AI=1`, im neuen Link der Ablauf „a pirate ship“:
  - Screenshots gegen `crafting-panel-ref-mix-v13.png` vergleichen;
  - die Ladephase gegen `bauplan-silhouette-frames.png` vergleichen.
- Desktop 1440 × 900, Tablet 834 × 1112 und Mobil 390 × 844.
- `/0` bis `/3` kurz gegenprüfen: unverändert.
