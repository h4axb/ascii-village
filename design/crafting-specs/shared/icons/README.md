# Icons · Crafting-Panel

Übersicht: `icons-v2-uebersicht.png`

## UI
| Datei | Wo | Maß / Farbe |
|---|---|---|
| `icon-back.svg`, `icon-close.svg`, `icon-history.svg` | Kopf, Verlauf-Tab | 22 bzw. 20 · Linie #DEDDB6 1,5 |
| `icon-coin-16.svg` | Coins | 16 · Pixel |
| `icon-hammer.svg`, `icon-hammer-active.svg` | Craft-Button | inaktiv / aktiv |
| `bookmark.svg`, `bookmark-hover.svg` | Verlauf-Tab | 38 × 58 |
| `icon-select.svg` | ▶ vor der aktiven Option | 11 × 16 · #F3E7C4 · 20 links vom Button |
| `icon-arrow-right.svg` | Pfeil hinter „Tune future crafts“ (eigenes Element, kein Textzeichen) | 14 · Gap 10 zum Text · Linie #DEDDB6 1,5 |
| `progress-dot-current/done/open.svg` | Fortschritt im Tune-Fenster | 9 × 9 · Coin / Coin dunkel / Linie 30 % · aktuell mit Ring 4 px 12 % |

## Textzeichen (kein SVG, in Figma als Text tippen)
Spielschrift Asciia Mono, Größe und Farbe wie der umgebende Text.
| Zeichen | Unicode | Wo | Farbe |
|---|---|---|---|
| ✦ | U+2726 | vor „You decide“, mit Leerzeichen | #F2B53C, Text danach #A3B190 |
| ▲ | U+25B2 | „▲ I like it“ | #DEDDB6 |
| ▼ | U+25BC | „▼ Not quite“ | #DEDDB6 |

## Präferenzen (`praeferenzen/`)
Die Bilder der Tune-Antworten, direkt aus dem Spiel übernommen.
- **Detail, Colour:** Sprites, Zelle 6 × 10. Detail zeigt Palme / Spielerin / Haus, Colour die blaue Blume mit der jeweiligen Farbstärke.
- **Surprise, Unknown words, Scope:** Glyph-Icons in Asciia Mono 14 px, Zeilenhöhe 14,7. Farben: Text #DEDDB6, Gold #F2B53C. In „Preferences saved“ sitzen sie in einer Box 64 × 52, Schrift 11 px.

## Preferences saved (Slide 03)
Eintrag 375 × 74 · Rand 1 #DEDDB6 15 % · Fläche #262B1C 55 % · Padding 10 / 12 · Gap 12 · Radius 7.
Links eine Bildbox **64 × 52** (bei allen gleich), das Bild mittig darin. Rechts der Text (Name 14 #DEDDB6 + Wert 14 #707D5F, je 16 hoch), vertikal mittig.

| Datei | Größe im Spiel |
|---|---|
| `summary-detail-less.png` | 38,7 × 47,8 (Sprite, 92 % der Box) |
| `summary-color-pastel.png` | 43,1 × 47,8 (Sprite, 92 % der Box) |
| `summary-surprise-surprise-me.png` / `.svg` | 59,4 × 57,75 (11 px, 5 Zeilen, ragt oben und unten ca. 3 über die Box) |
| `summary-unknown-craft-them-anyway.png` / `.svg` | 59,4 × 46,2 (11 px, 4 Zeilen, oben und unten je eine leer) |

PNGs in 4× mit transparentem Hintergrund. In Figma auf die angegebene Größe setzen.
