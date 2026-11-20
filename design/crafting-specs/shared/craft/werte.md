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
- **Grundlage:** das Ergebnis des Spiels mit Detail „Less“ und „Pastel“ („a pirate ship“). Die Farben sind Zelle für Zelle aus dem Referenzbild übernommen. 54 × 27 Zellen, Zelle 6 × 10.
- **Totenkopf:**
  - zweites Auge `__` links vom vorhandenen, in Reihe 10–11 und Zellen 34–35, gleich wie das erste (Glyphe #6F6D69);
  - Zähne: in der untersten Reihe fehlen das 3., 5. und 7. `@` von links, bis zum 3. von rechts. Die Lücken zeigen das Segel.
- **Überraschung:** Punkte auf beiden vorderen roten Fahnen, jede 3. Zelle diagonal versetzt (10 Punkte). `•` #D9A48C auf #FFF4E0.
