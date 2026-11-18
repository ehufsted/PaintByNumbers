# PaintByNumbers

Turn an image into a paint-by-numbers design: a limited palette, regions a brush
can paint and a number can fit in, a preview of the painted result, and a
printable pattern with the numbers.

- **Style:** filters applied to the image, in an order you choose, before its
  colors are matched: *Median* (removes speckle and JPEG noise, keeps edges),
  *Blur* (Gaussian), *Local contrast* (CLAHE: flat or washed-out areas get
  distinct tones), *Sharpen* (unsharp mask) and *Painterly* (an edge-preserving
  Kuwahara filter that flattens texture into brush-like patches; on by default).
- **Palette:** *From the image* picks N colors by clustering (k-means in OKLab,
  seeded, so the same image always gives the same colors). *Merge colors closer
  than* (on by default, 4 ΔE) merges colors no one could tell apart in a pot and
  gives the freed slots to colors that are distinct. *My colors* is your
  own list: type hex codes, sample them from a photo of your paints, take them
  from the image, or load a saved palette. Colors are numbered light to dark
  (the order to paint in) or as listed, for paints that are already numbered.
  Two colors that are hard to tell apart (under 3 ΔE) are flagged.
- **Detail:** *Clean-up* gives each pixel the
  color most common around it, which removes speckle. *Narrowest* is the
  narrowest a region, or any part of one, may be: thinner parts go to the
  regions beside them. *Smallest region* is the least area: smaller regions join
  the neighbour nearest their color. *Edge smoothing* rounds the boundaries.
  Fine / Medium / Coarse set these and the Painterly brush.
- **Shared boundaries:** each boundary between two regions is found and smoothed
  once, and both regions are built from it, so neighbours always meet exactly
  (no gaps, no double lines) however much it is smoothed.
- **Numbers:** every number is one size (*Number size*), at the point of its
  region farthest from the edge. A region too small for it keeps its color,
  and its number goes outside, at the nearest spot with room, on a short leader
  line to a dot inside it.
- **Pattern:** line width, line darkness and number darkness, and numbers on or
  off. Light grey lines are covered by one coat of paint; black shows through
  pale colors.

## Run it

No install. From this folder:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

then open <http://localhost:8080/>. (Any static server works; the page only has to
be served over HTTP, not opened as a file.)

## Views

**Painted** (every region in its color), **Pattern** (as it prints),
**Overlay** (the pattern over the image), **Source**, **Difference** (ΔE between
the painted colors and the image: white on target, amber about 10, dark red 20
or more) and **Problems** (orange: a number outside on a leader; red: crowded,
no room even outside). Hover a region to
see its color, area and number size; click a region, or a row of the color key,
to outline every region of that color.

## Canvas

Width and height in mm or inches, or a kit size (8 × 10 in to 40 × 50 cm), which
turns to the image's orientation. Height 0 follows the image; a fixed height
crops the image to cover the canvas (it is never stretched). *Precision* is the
resolution the regions are found at: Draft (1000 px on the long side), Normal
(1600) or Fine (2400).

## Outputs

| Button | What |
| --- | --- |
| Print / PDF… | The color key (swatch, number, name, regions, area, share, a paint estimate) with the painted preview and a small numbered pattern; the whole numbered pattern on one page; the pattern at 1:1 split across pages that overlap by 10 mm, each with a 50 mm bar to check the scale. The 1:1 pages are bare lines unless *Print numbers on 1:1 pattern?* is ticked. Print at 100%. |
| Pattern SVG | The pattern at true size: every boundary once, the numbers and leaders. |
| Painted SVG | The painted result at true size. |
| Key CSV | Per color: number, hex, name, regions, area, share, paint. |
| PNG | The current view. |

**Projects**: *Save project* writes the image (its original file) and every
setting to a `.pbn.json` file; *Open project* restores them and rebuilds the same
design.

## Verify

```
powershell -ExecutionPolicy Bypass -File run-tests.ps1
```

runs the harness (`verify.html`) in headless Chrome or Edge and prints every check;
`-Only core.planar,pipeline` runs a subset. Or open
<http://localhost:8080/verify.html>. With node or deno available, `node run-tests.mjs`
does the same.

The structure (layers, the method registry, the DOM-free harness) follows
HalftoneCuttable and Photo2Mosaic; `docs/architecture.md` has the invariants.
