# Craft-Ergebnisse · Piratenschiff

Prompt bei allen drei: **„a pirate ship“**. Gecraftet mit dem echten Renderer des Spiels, aus der Referenzbibliothek (`boat-pirate-ship`).

| Datei | Variante | Eingaben | Raster | Glyphen |
|---|---|---|---|---|
| `variante-a-clarify` | A · Pre-Clarification, finales Ergebnis | Größe **Large** · Farbe **Blue** · Überraschung **Keep it classic** | 88 × 44 | 2056 |
| `variante-b-standard` | B · erstes Ergebnis | keine Präferenzen | 82 × 40 | 1700 |
| `variante-b-wenige-glyphen` | B · nach „Tune future crafts“ | Detail **Less** · Rest übersprungen · gilt für **All crafts** | 54 × 27 | 766 |

- **A:** Größer und blau, so wie es die Antworten auf Mitchys Fragen festlegen: blaue Flagge und Segel, dunkelblauer Rumpf. Das Asset ist umgefärbt aus dem gecrafteten Ergebnis; Raster und Glyphen sind gleich geblieben.
- **B · wenige Glyphen:** Gleiche Form wie das Standard-Ergebnis, aber mit rund 45 % der Glyphen. Die Zeichen sind dafür größer. Im Spiel bleibt das Schiff gleich groß.

Dateien:
- **SVG:** Jede Zelle ist ein Hintergrund-Rechteck plus ein Zeichen in Cascadia Code 10 px, Zelle 6 × 10. Angezeigt werden alle drei mit 300 px Breite.
- **PNG:** 4×, transparenter Hintergrund. Nimm das PNG, wenn Figma die Zeichen im SVG verschiebt.

## Variante A mit Überraschung
`variante-a-sterne.svg` / `.png`: das blaue Piratenschiff aus `variante-a-clarify` (gleiches Raster, gleiche Glyphen) mit der Überraschung „stars sparkling around the ship“. Pixel-Sterne in drei Größen, orange Strahlen #F1943A, gelber Kern #FBDD3C, ohne Kontur, nur auf leeren Zellen; Segel und Totenkopf bleiben. Transparenter Hintergrund.

## Variante B · Pastell, weniger Glyphen, Punkte (`variante-b-pastell-punkte.svg`)
- **Raster:** 56 × 31 Zellen (Standard 82 × 40), 1 Bildpixel = 2 Zellen, Zelle 6 × 10. Rund 1.050 statt 1.700 belegte Zellen.
- **Eine Glyphe pro Material:**
  - Segel `+`
  - Totenkopf `@`
  - Deck und Rumpf `=`
  - Schattenkante `_`
  - Kiel `^`
  - Masten `|`
  - Bugspriet und Tau `/`
  - Flaggen `~`
  - Bullaugen `o`
- **Pastell:** die Formel des Spiels (`adjustHex(hex, -1)`: Sättigung × 0,9, Helligkeit 60 % Richtung 0,86). Fläche = Pastellfarbe, Glyphe = Pastellfarbe × 0,72.
- **Totenkopf:** 8 px breit und symmetrisch: zwei Augen, Nase, Kiefer mit Zahnlücken, gekreuzte Knochen. Fläche #F5F7FA, Augen und Nase #3A4148.
- **Überraschung:** Punkte auf beiden vorderen Segeln. Raster: jedes 4. Pixel, jede 2. Reihe, versetzt. Fläche #FFF4E0, `•` #E8C4A0.
