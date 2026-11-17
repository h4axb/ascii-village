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
| Verlauf-Tab | rechts am Frame | 38 × 58 · r 0 7 7 0 |
| Chat | V · scrollt | gap 18 · pad 4 8 4 4 |
| Msg | H (rechts: gespiegelt) | gap 18 |
| Avatar | V | 84 breit · Box 76 × 76 · r 7 · gap 7 · Name 14 · ls 0.5 · #EFC862 |
| Bubbles | V | gap 10 · Bubble max min(480, 64 %) |
| Bubble | Text | pad 12 20 · r 7 · Rand 1 · 85 % · Fläche #262B1C · 14 / 22 |
| Optionen | V · rechtsbündig | 360 breit · gap 8 · Option 360 × 40 · pad 11 30 · r 7 |
| Bottom | H · Linie oben 1 | pt 16 · gap 16 |
| Eingabe | H · fill | × 56 · pad 0 20 · gap 12 · Text 15 · Zähler 12 · r 7 · Ecken 10 |
| Craft | H | 200 × 56 · pad 0 34 · gap 16 · 17 px · r 7 |

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
| Token | Wert |
|---|---|
| Text | #DEDDB6 |
| Text soft | #A3B190 |
| Muted | #707D5F |
| Name | #EFC862 |
| Coin | #F2B53C |
| Coin dunkel | #B07A1C |
| Go | #7FB069 |
| Go Fläche | #7FB069 · 22 % |
| Auswahl | #F3E7C4 |
| Bubble / Option | #262B1C |
| Surface | #262B1C · 55 % |
| Chat-Rahmen (Frame) | #1C2014 · 72 % |
| Dialog | #1C2014 · 88 % |
| Linie | #DEDDB6 · 30 % |
| Linie soft | #DEDDB6 · 15 % |
| Linie stark | #DEDDB6 · 85 % |
| Nicht ganz | Rand #D29A85 · Fläche #D27864 · 18 % |
| Chip aktiv | Rand #F2B53C · Fläche 12 % |

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
