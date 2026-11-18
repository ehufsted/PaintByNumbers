# Architecture

These are the invariants that no single file is the right home for. A module's own
header explains its reasoning; this page is what holds across modules.

## Layers

```
shim/      image resize, mulberry32 (copied verbatim from Photo2Mosaic)
core/      units, color, raster (the work grid), palette (k-means, numbering),
           quantize (nearest color, majority clean-up), segment (the detail
           limits), planar (shared boundaries), geom, labels (where numbers
           go), svg, printout, project; and, copied, edt (plus edtNearest),
           kuwahara, steer, features (HalftoneCuttable)
methods/   one module per way of making regions (flat); imports core/ only
pipeline.js  the whole chain, with its stage cache; imports methods/ and core/
worker.js  wraps pipeline.js and keeps the image and the cache between runs
app.js     UI; the only DOM user (plus svg.downloadFile)
```

Dependencies run downward only. Nothing under `core/` imports `methods/`.

## One grid, then millimeters

Everything up to the region map happens on ONE work raster laid over the canvas
(`core/raster.js`, its long side set by Precision). The planar map turns the
region map into shapes in mm, and from then on nothing reads pixels except the
clearance map the leader search uses. The PLAN holds no pixels: regions as rings
in mm, boundaries as chains in mm, numbers as points and sizes in mm. Every view,
the pattern, the printout and the SVGs draw that same plan.

## Regions tile the canvas, by construction

A region's outline is never traced or smoothed on its own. The boundaries are
CHAINS between NODES (corners where three regions meet, or two meet diagonally);
each chain is smoothed once (`core/planar.js`), with its end nodes pinned, and
every region is put together from the chains around it. Two neighbours therefore
share the exact same curve, and the regions tile the canvas whatever the
smoothing, as long as no two chains cross. Smoothing is held to a quarter of the
narrowest region (`pipeline.js`) so they cannot. The harness checks both on random
maps: unsmoothed, each region's polygon area equals its pixel count and every
pixel centre is in its own region only; smoothed, random points each lie in
exactly one region and the areas sum to the canvas.

Regions are read EVEN-ODD (a point is inside when a ray crosses its rings an odd
number of times), so nothing needs to know which ring is a hole. Regions are
4-connected; where a region touches itself diagonally the ring takes the left
turn, which keeps diagonal pixels apart, as 4-connectivity means.

## The detail limits

Width first, then area (`core/segment.js`). The WIDTH limit is an opening whose
leftovers go to the neighbours: a pixel is core when a disc of half the
narrowest width around it stays in its color, and every pixel takes its NEAREST
core's color (`edtNearest`). So a sliver is split between the regions either
side, and corners round to the brush. The AREA limit merges small regions into
the neighbour nearest their own mean color, smallest first; a merge only ever
grows a region, so it cannot undo the width limit. What an opening a pixel under
the limit then removes is only corners (a few pixels each), never a sliver; the
harness checks it.

## Numbers: inside, or outside on a leader

Each number is at its region's pole of inaccessibility (polylabel), sized to fit
the circle there less half the line. A region whose circle is too small for the
smallest size keeps its color (the user's choice: small accents are worth
keeping), and its number is placed at the nearest spot around it with room for
it (clearance from the work raster) that overlaps no other number. Numbers that
fit are placed first, so a leader never displaces one. When there is no room at
all the number stays inside at the smallest size and is counted as crowded.

## The stage cache

`pipeline.js` runs four stages (A raster and pre-filter, B palette and regions,
C shapes, D numbers). Each remembers the JSON of the settings it was made from,
including the earlier stages' keys; the worker keeps the cache between runs. A
change to the number sizes re-runs only D (0.1 s against 3.4 s for the Mona Lisa
at Normal). The harness checks a cached run equals a fresh one. The image is
named by a key the app changes per image, so the cache never serves another
image's stage. The app sends the pixels only with a new image.

## Room for gradients

A method (`methods/`) returns the region map and gives each region its fill;
every region carries `fill: {type: 'solid'}` today. A gradient method would make
regions the same way and return another fill type; the planar map, numbers and
outputs do not change. Manual editing (merging or recoloring regions) can work on
the plan's regions and their `nbrs` lists.
