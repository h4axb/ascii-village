# Crafting-Panel · Specs (Variante 1 + 2)

Desktop 1440 × 900 · alle Werte in px · Schrift **Asciia Mono 400**
(Asciia Mono ist Cascadia Code, für Figma reicht Cascadia Code).

## Layout
| Ebene | Aufbau | Maße |
|---|---|---|
| Screen | Overlay #050505 · 78 % über der Spielwelt | 1440 × 900 |
| Sheet | zentriert · Fläche #181B11 · 42 % · Blur 14 | min(1180, 96vw) × 100dvh · pad 22 40 26 |
| Top | H · space-between | mb 22 |
| Back / Close | Icon-Button | 46 × 42 · r 7 · Rand 1 |
| Corner | V · end | gap 14 |
| Coins | H | 94 × 36 · pad 7 18 7 14 · gap 12 · 17 px · ls 0.5 |
| Frame | V · fill · Fläche #1C2014 · 72 % | min(1100, 86vw) × fill · pad 24 28 20 28 · r 12 · Rand 1 · 85 % · Ecken 16 × 16, 2 px gestrichelt, 9 vom Rand |
| Verlauf-Tab | rechts am Frame, 11 unter Oberkante | 38 × 58 · r 0 7 7 0 · Kerbe 8 · Rand oben + rechts · Icon 20 bei 8.5/15 · `shared/icons/bookmark(-hover).svg` |
| Chat | V · scrollt | gap 18 · pad 4 8 4 4 |
| Msg | H (rechts: gespiegelt) | gap 18 |
| Avatar | V | 84 breit · Box 76 × 76 · r 7 · gap 7 · Name 14 · ls 0.5 · #EFC862 |
| Bubbles | V | gap 10 · Bubble max min(480, 64 %) |
| Bubble | Text | pad 12 20 · r 7 · Rand 1 · 85 % · Fläche #262B1C · 14 / 22 |
| Optionen | V · rechtsbündig | 360 breit · gap 8 · Option 360 × 40 · pad 11 30 · r 7 |
| Bottom | H · Linie oben 1 | pt 16 · gap 16 |
| Eingabe | H · fill | × 56 · pad 0 20 · gap 12 · Text 15 · Zähler 12 · r 7 · Ecken 10 |
| Craft | H | 200 × 56 · pad 0 34 · gap 16 · 17 px · r 7 |

## Icons & Schrift
- **Schrift:** Asciia Mono ist Cascadia Code (Microsoft, frei: github.com/microsoft/cascadia-code). Installieren und in Figma „Cascadia Code“ Regular 400 wählen.
- **Zeichen im Text:** ▶ ▲ ▼ ✦ → sind Schriftzeichen, keine Icons.
- **Linien-Icons** (`shared/icons/`): Raster 24, angezeigt 22 × 22, Strich 1.5, runde Enden.
  - X, Zurück, Verlauf: #DEDDB6
  - Hammer im Craft-Button: #EFC862 inaktiv, #E6F4DC aktiv
- **Münze:** Pixel-Icon 16 × 16 aus einzelnen 1-px-Rechtecken (`icon-coin-16.svg`). Beim Skalieren nur ganze Vielfache (16, 32 …) verwenden, damit es scharf bleibt.

## Chat-Bubble (Original aus dem Spiel)
SVGs in `shared/bubble-original/`: Mitchy (Schweif links) und Spieler (Schweif rechts), je 480 × 70 (2 Zeilen) und 300 × 48 (1 Zeile), jeweils auch ohne Schweif.

**In Figma bauen:**
1. **Rechteck:** Fill #262B1C · Stroke 1, Inside, #DEDDB6 · 85 % · Radius 7.
2. **Auto Layout:** horizontal · Padding 12 / 20 · Hug · max. Breite 480. Text Cascadia Code 14, Zeilenhöhe 22, #DEDDB6.
3. **Schweif als Rechteck:** 10 × 10 · Fill #262B1C · Stroke 1 nur auf zwei Seiten (Mitchy: links + unten, Spieler: rechts + oben), #DEDDB6 · 85 %.
4. **Drehen:** 45°.
5. **Absolut positionieren:** Mittelpunkt genau auf der Außenkante der Bubble, 34 px unter der Oberkante. Den Schweif über das Rechteck legen. Weil die Fläche gleich ist, verdeckt er dort die Randlinie.
6. **Nur die erste Bubble** einer Nachricht bekommt den Schweif. Weitere Bubbles stehen darunter mit Abstand 10.

## Craft-Ergebnisse
Drei Piratenschiffe (Variante A und zweimal B) als SVG und PNG in `shared/craft/`; Werte in `shared/craft/werte.md`.

## Eck-Winkel (einzelne Striche)
Strich 2 px · #DEDDB6 · 30 % · eckige Enden · Aufteilung je Arm: leer 3.5 · Strich 6.5 · Lücke 3.5 · Strich 2.5 = 16 (10er: leer 3.5 · Strich 6.5). Die Außenecke bleibt leer. Die Maße gelten für oben links und werden für die anderen Ecken gespiegelt.
SVGs je Ecke: `shared/ecken/` (einzelne Rechtecke, direkt in Figma ziehen).

| Winkel | waagerecht (x, Länge) | senkrecht (y, Länge) |
|---|---|---|
| Frame 16 × 16 · 9 vom Rand | 3.5 → 6.5 · 13.5 → 2.5 | 3.5 → 6.5 · 13.5 → 2.5 |
| Eingabe / Bild 10 × 10 · 5 vom Rand | 3.5 → 6.5 | 3.5 → 6.5 |

## Variante 1 · Pre-Clarification
| Komponente | Maße |
|---|---|
| Plan-Panel | 520 breit · pad 16 18 · r 10 · Rand 1 · 30 % |
| Antwort-Tag | h 30 · pad 6 11 · r rund · aktiv: Gold-Rand #F2B53C, Fläche 12 % |
| Bewertung | 560 × 330 (feste Höhe) · pad 16 18 · r 10 |
| Vote-Button | 255 × 48 · pad 14 10 · r 7 · gap 12 |

## Variante 2 · Feedback
| Komponente | Maße |
|---|---|
| Ergebnis-Karte | in einer Bubble · 300 breit · Bild 300 × 170 · r 7 · Typ-Tag h 17 · 11 px |
| Vote-Panel | 560 breit · pad 16 18 · r 10 · Titel 16 · Hinweis 12 |
| Vote-Button | 255 × 48 · aktiv ▼: Rand #D29A85, Fläche #D27864 · 18 % |
| Gründe-Chips | wrap · gap 7 · h 30 · pad 6 11 · r rund · 14 px |
| Kommentar | Label 14 · Feld 1 Zeile · Hinweis 12 |
| Tune-Frage | ersetzt den Chat · 760 breit · Eyebrow 12 · Titel 22 · Hilfe 13 |
| Antwortkarte | 3 × 244 × 176 · gap 14 · pad 14 10 · r 10 · Name 15 · Text 12 |
| Fortschritt | Punkte 9 · gap 7 · aktuell Gold |

## Farben
Transparente Werte als Hex + Deckkraft (in Figma: Fill-Opacity).

| Gruppe | Name | Wert | Wo |
|---|---|---|---|
| Text | Text | #DEDDB6 | Bubble, Buttons |
| Text | Text soft | #A3B190 | You decide, Typ-Tag |
| Text | Muted | #707D5F | Zähler, Hinweise |
| Text | Name | #EFC862 | Name, Craft inaktiv |
| Text | Go-Text | #E6F4DC | Craft aktiv, Zurück |
| Text | Auswahl | #F3E7C4 | ▶ vor Option, Tab-Hover |
| Akzent | Coin | #F2B53C | Chip on, Fokus, Punkt aktuell |
| Akzent | Coin dunkel | #B07A1C | Punkt erledigt |
| Akzent | Go | #7FB069 | Craft aktiv Rand |
| Akzent | Nicht ganz | #D29A85 | Vote ▼ Rand |
| Fläche | Bubble | #262B1C | Bubble, Option, Panels |
| Fläche | Craft inaktiv | #262B1C · 90 % | Craft-Button |
| Fläche | Surface | #262B1C · 55 % | Icon-Buttons, Coins, Chips |
| Fläche | Hover | #DEDDB6 · 9 % | Hover |
| Fläche | Chat-Rahmen | #1C2014 · 72 % | Frame |
| Fläche | Avatar-Box | #1C2014 · 88 % | Avatar, Verlauf |
| Fläche | Verlauf-Tab | #1C2014 · 90 % | Tab |
| Fläche | Tab Hover | #2E3422 · 95 % | Tab offen |
| Fläche | Eingabe | #000000 · 20 % | Prompt |
| Fläche | Bildfläche | #000000 · 18 % | Ergebnis-Bild |
| Fläche | Kommentar | #000000 · 25 % | Feld V2 |
| Fläche | Tooltip | #10140B | Tune-Hinweis |
| Fläche | Sheet | #181B11 · 42 % + Blur 14 | Panel |
| Fläche | Overlay | #050505 · 78 % | über Spielwelt |
| Fläche | Scrim | #050505 · 35 % | hinter Verlauf |
| Zustand | Go Fläche | #7FB069 · 22 % | Craft aktiv |
| Zustand | Go Hover | #7FB069 · 34 % | Craft Hover |
| Zustand | Nicht ganz Fläche | #D27864 · 18 % | Vote ▼ aktiv |
| Zustand | Gold 12 % | #F2B53C · 12 % | Chip on, Fokus-Ring 4 |
| Zustand | Peer-Chip | Rand #7FB069 · 45 %, Fläche 16 % | Tags anderer (V1) |
| Linie | Linie | #DEDDB6 · 30 % | Standard, Ecken |
| Linie | Linie soft | #DEDDB6 · 15 % | Trenner |
| Linie | Linie stark | #DEDDB6 · 85 % | Bubble, Frame, aktiv |
| Münze | Pixel-Icon | #5A2A12 · #FFF4C2 · #FFFFFF · #FDD23A · #FFE57A · #F8B616 · #E8960F · #D9761A | Coins |

Deaktiviert: Deckkraft 45 %. Schatten Verlauf: −10 0 28 · #000 35 %.

## Typo
22 Tune-Titel · 17 Craft, Coins · 16 Vote-Titel, Karten-Titel · 15 Eingabe, Antwort-Name ·
14 Bubble (lh 22), Option, Chip, Name · 13 Tune-Hilfe · 12 Zähler, Eyebrow · 11 Hinweis, Typ-Tag

## Radien · Abstände
- **Radien:** 7 Buttons, Bubble, Eingabe · 10 Panels, Karten · 12 Frame · rund Chips, Tags
- **Abstände:** 4 · 7 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 28 · 40

## Skalierung
- **Sheet:** min(1180, 96vw), Höhe 100dvh, die Inhalte füllen sie.
- **Bubbles:** max min(480, 64 %), Optionen 360.
- **390 px:** Sheet 374, Avatar 60, Bubbles füllen die Breite.
