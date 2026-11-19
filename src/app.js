// UI wiring. Compute happens in worker.js; this module gathers settings, paints
// the plan and exports it. The only file that knows what a DOM is (plus
// svg.js's download helper).
//
// LENGTHS ARE HELD IN mm. Every length field (class "len") shows its value in
// the chosen units, and `state.s` keeps the millimeters; switching units only
// rewrites what the fields display. The smallest region is an area (mm² / in²).
//
// THE PREVIEW IS DRAWN FROM THE PLAN, not from pixels the worker made: the plan
// is geometry in mm, so every view is crisp at any zoom, and what is on screen
// is what the pattern will print. The pattern's look (line darkness, numbers on
// or off) is display only and never re-runs the worker.

import { DEFAULTS, PRESETS, toMm, pieceGeometry, applyTone } from './core/units.js';
import { LINEAR_LUT, linearToHex, normalizeHex, rgbToOKLab } from './core/color.js';
import { autoPalette, numberPalette, closePairs } from './core/palette.js';
import { inRings } from './core/geom.js';
import { patternSVG, paintedSVG, inkHex, leaderStart, downloadFile, FONT, BASELINE } from './core/svg.js';
import { planHTML, PAPERS, pageWindows, printable, fmtLen, areaText, paintMl } from './core/printout.js';
import { projectJSON, parseProject, DISPLAY } from './core/project.js';
import { filterById, defaultStyle } from './core/style.js';
import { COLOR_SETS, colorSet } from './core/colorsets.js';
import { generateSample } from './app/samples.js';
import { gridLines, gridLabels, gridFont, GRID_COLOR } from './core/grid.js';

const $ = (id) => document.getElementById(id);
const STORE = 'paintbynumbers.v1';

const LEN_IDS = ['widthMm', 'heightMm', 'cleanup', 'minWidth', 'edgeSmooth', 'lineWidth', 'fontSize'];
const MM2_PER_IN2 = 645.16;

/** The Detail presets, mm (and mm² for the area); brush is the Painterly filter's. */
const DETAIL = {
  fine: { brush: 1, cleanup: 0.4, minWidth: 1.8, minArea: 5, edgeSmooth: 0.4 },
  medium: { brush: 1.5, cleanup: 0.6, minWidth: 2.5, minArea: 10, edgeSmooth: 0.6 },
  coarse: { brush: 2.5, cleanup: 1, minWidth: 4, minArea: 25, edgeSmooth: 1 },
};
const detailValue = (s, key) => (key === 'brush' ? s.style.params.kuwahara.size : s[key]);

const freshSettings = () => ({ ...DEFAULTS, colors: [], style: defaultStyle() });

const state = {
  rgba: null,           // {width, height, data} as loaded
  imageName: 'design',
  imageSrc: null,       // for projects: {kind:'sample', name} | {kind:'file', name, dataURL}
  imageKey: 0,          // a new number per image, so the worker's cache never mixes two
  workerHas: null,      // the imageKey the worker holds
  toned: null,          // canvas of the toned image, for the Difference view (and until a run sends `styled`)
  styled: null,         // canvas of the work raster after Tone and Style, for the Source and Overlay views; it covers the canvas exactly
  units: 'mm',
  preset: 'custom',
  s: freshSettings(),   // the pipeline's settings, mm
  disp: { ...DISPLAY },
  view: 'painted',
  plan: null,
  hitGrid: null,        // spatial hash over the plan's regions, for hover
  selColor: -1,         // a color picked in the key: its regions are outlined
  jobId: 0,
  pending: false,
};
window.paintByNumbers = state;   // for driving the app from DevTools / the CDP harness

// ------------------------------------------------------------------ persistence
// Only conveniences live in localStorage: a private window or blocked storage
// just starts from the defaults.
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ units: state.units, preset: state.preset, s: state.s, disp: state.disp }));
  } catch { /* storage unavailable */ }
}

function restore() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { o = null; }
  if (!o) return;
  try {
    const { project } = parseProject({ app: 'PaintByNumbers', version: 1, image: null, units: o.units, settings: o.s, display: o.disp });
    state.units = project.units;
    state.s = project.settings;
    state.disp = project.display;
    if (o.preset === 'custom' || PRESETS.some((p) => p.id === o.preset)) state.preset = o.preset;
  } catch { /* keep defaults */ }
}

// ------------------------------------------------------------------ worker
let worker = null;

function spawnWorker() {
  state.workerHas = null;
  try {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = onWorkerMessage;
    w.onerror = (e) => setStatus(`worker error: ${e.message}`, 'bad');
    return w;
  } catch (err) {
    setStatus('module workers unavailable — see console', 'bad');
    console.error(err);
    return null;
  }
}
worker = spawnWorker();

/** A busy worker cannot see a stop message; terminating it is the only cancel. */
function cancelInFlight() {
  if (!worker || !state.pending) return;
  worker.terminate();
  worker = spawnWorker();
  state.pending = false;
}

function onWorkerMessage(ev) {
  const msg = ev.data;
  if (msg.jobId !== state.jobId) return;
  if (msg.type === 'progress') { setStatus(msg.stage + '…'); return; }
  if (msg.type === 'error') {
    state.pending = false;
    if (msg.code === 'NO_IMAGE') { state.workerHas = null; run(); return; }
    setStatus(`error: ${msg.message}`, 'bad');
    console.error(msg.stack || msg.message);
    return;
  }
  if (msg.type === 'done') {
    state.pending = false;
    // a highlighted color is a palette position: keep it only while the palette is the same
    const hexes = (p) => (p ? p.palette.map((q) => q.hex).join() : '');
    if (hexes(state.plan) !== hexes(msg.plan)) state.selColor = -1;
    state.plan = msg.plan;
    if (msg.styled) {
      const c = document.createElement('canvas');
      c.width = msg.styled.width; c.height = msg.styled.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(msg.styled.data), c.width, c.height), 0, 0);
      state.styled = c;
    }
    state.hitGrid = buildHit(msg.plan);
    setStatus(`ready · ${(msg.ms / 1000).toFixed(1)} s`);
    paint();
    updateStats();
    renderKey();
    renderAutoPalette();
    renderWarnings();
    renderTargetNote();
  }
}

// ----------------------------------------------------------------- settings
const num = (id) => parseFloat($(id).value);

/** Catch settings the pipeline would reject, and say why here rather than as an error. */
function validate(s) {
  if (!(s.widthMm > 0)) return 'enter a width';
  if (!(s.heightMm >= 0)) return 'height must be 0 (from the image) or more';
  if (s.paletteMode === 'custom' && !s.colors.length) return 'add a color to the palette';
  if (!(s.fontSize > 0)) return 'the numbers need a size';
  if ([s.cleanup, s.minWidth, s.minArea, s.edgeSmooth, s.lineWidth].some((v) => !(v >= 0))) return 'lengths cannot be negative';
  return '';
}

function run() {
  if (!state.rgba || !worker) return;
  const s = { ...state.s, gamma: num('gamma'), brightness: num('brightness'), saturation: num('saturation') };
  state.s.gamma = s.gamma; state.s.brightness = s.brightness; state.s.saturation = s.saturation;
  updatePieceNote();
  const problem = validate(s);
  if (problem) { setStatus(problem, 'bad'); return; }
  save();
  cancelInFlight();
  if (!worker) return;
  state.jobId++;
  state.pending = true;
  setStatus('working…');
  const send = state.workerHas !== state.imageKey;
  worker.postMessage({ type: 'run', jobId: state.jobId, imageKey: state.imageKey, rgba: send ? state.rgba : undefined, settings: s });
  state.workerHas = state.imageKey;
}

let runTimer = null;
function scheduleRun(delay = 300) {
  clearTimeout(runTimer);
  runTimer = setTimeout(run, delay);
}

// ------------------------------------------------------------------- units
const L = (mm, dp) => fmtLen(mm, state.units, dp ?? (state.units === 'in' ? 4 : 2));
const unitLabel = () => (state.units === 'in' ? 'in' : 'mm');

function showLengths() {
  for (const id of LEN_IDS) $(id).value = L(state.s[id]);
  $('gridMm').value = L(state.disp.gridMm);
  const a = state.units === 'in' ? state.s.minArea / MM2_PER_IN2 : state.s.minArea;
  $('minArea').value = String(Math.round(a * 10000) / 10000);
  $('areaUnit').textContent = state.units === 'in' ? 'in²' : 'mm²';
  for (const el of document.querySelectorAll('.u')) el.textContent = unitLabel();
  for (const b of document.querySelectorAll('#unitSeg button')) b.setAttribute('aria-pressed', String(b.dataset.units === state.units));
  updateFontNote();
  showDetailPreset();
}

/** Which Detail preset the values match, if any. */
function showDetailPreset() {
  const s = state.s;
  const at = Object.keys(DETAIL).find((k) => Object.entries(DETAIL[k]).every(([key, v]) => Math.abs(detailValue(s, key) - v) < 1e-6));
  for (const b of document.querySelectorAll('#detailSeg button')) b.setAttribute('aria-pressed', String(b.dataset.detail === at));
}

/** Aiming for a number of regions: what was reached, and the limits that reached it. */
function renderTargetNote() {
  const el = $('targetNote'), plan = state.plan;
  el.hidden = !state.s.targetOn;
  if (!state.s.targetOn || !plan || !plan.detail) { el.textContent = 'the limits below set the proportions; their level is found on the next run'; return; }
  const d = plan.detail;
  const area = state.units === 'in' ? `${(d.minArea / MM2_PER_IN2).toFixed(4)} in²` : `${d.minArea.toFixed(1)} mm²`;
  el.textContent = `${plan.stats.regions} regions (aiming for ${state.s.target}): the limits below ×${d.f.toFixed(2)}, ` +
    `so narrowest ${L(d.minWidth)} ${unitLabel()}, smallest region ${area}, clean-up ${L(d.cleanup)} ${unitLabel()} · ${d.tries} ${d.tries === 1 ? 'try' : 'tries'}`;
}

function updateFontNote() {
  const pt = (mm) => (mm * 72 / 25.4).toFixed(1);
  $('fontNote').textContent = `${pt(state.s.fontSize)} pt; a digit is about ${L(0.72 * state.s.fontSize)} ${unitLabel()} tall. Every number is this size.`;
}

function bindLengths() {
  for (const id of LEN_IDS) {
    $(id).addEventListener('input', () => {
      const v = parseFloat($(id).value);
      if (!isFinite(v)) return;
      state.s[id] = toMm(v, state.units);
      if (id === 'widthMm' || id === 'heightMm') { state.preset = 'custom'; $('preset').value = 'custom'; }
      if (id === 'fontSize') updateFontNote();
      showDetailPreset();
      scheduleRun();   // every length re-runs (the line width too: numbers keep clear of it)
    });
  }
  $('minArea').addEventListener('input', () => {
    const v = parseFloat($('minArea').value);
    if (!isFinite(v)) return;
    state.s.minArea = state.units === 'in' ? v * MM2_PER_IN2 : v;
    showDetailPreset();
    scheduleRun();
  });
  for (const b of document.querySelectorAll('#unitSeg button')) {
    b.addEventListener('click', () => {
      state.units = b.dataset.units;
      showLengths();
      buildStyleUI();
      updatePieceNote();
      updateStats();
      renderKey();
      save();
    });
  }
  for (const b of document.querySelectorAll('#detailSeg button')) {
    b.addEventListener('click', () => {
      const { brush, ...rest } = DETAIL[b.dataset.detail];
      Object.assign(state.s, rest);
      state.s.style.params.kuwahara.size = brush;
      showLengths();
      buildStyleUI();
      scheduleRun(0);
    });
  }
  $('precision').addEventListener('change', () => { state.s.precision = $('precision').value; scheduleRun(0); });
  $('targetOn').addEventListener('change', () => { state.s.targetOn = $('targetOn').checked; renderTargetNote(); scheduleRun(0); });
  $('target').addEventListener('input', () => {
    const v = parseInt($('target').value, 10);
    if (v >= 1) { state.s.target = v; scheduleRun(400); }
  });
}

// ------------------------------------------------------------------ canvas size
function buildPresets() {
  $('preset').innerHTML = '<option value="custom">Custom</option>' + PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  $('preset').value = state.preset;
  $('preset').addEventListener('change', () => {
    state.preset = $('preset').value;
    applyPreset();
    showLengths();
    scheduleRun(0);
  });
}

/** Set the canvas to the preset, turned to the image's orientation. */
function applyPreset() {
  const p = PRESETS.find((q) => q.id === state.preset);
  if (!p) return;
  const landscape = state.rgba ? state.rgba.width >= state.rgba.height : false;
  state.s.widthMm = landscape ? p.long : p.short;
  state.s.heightMm = landscape ? p.short : p.long;
}

function updatePieceNote() {
  if (!state.rgba) return;
  const geo = pieceGeometry(state.rgba, state.s);
  const other = state.units === 'in' ? 'mm' : 'in';
  $('pieceNote').innerHTML = `canvas <b>${fmtLen(geo.W, state.units)} × ${fmtLen(geo.H, state.units)} ${unitLabel()}</b> ` +
    `(${fmtLen(geo.W, other)} × ${fmtLen(geo.H, other)} ${other})` +
    (state.s.heightMm > 0 ? ' · image cropped to cover' : '');
}

// ------------------------------------------------------------------ palette
function setPaletteMode(mode) {
  state.s.paletteMode = mode;
  for (const b of document.querySelectorAll('#palSeg button')) b.setAttribute('aria-pressed', String(b.dataset.pal === mode));
  $('autoGroup').hidden = mode !== 'auto';
  $('customGroup').hidden = mode !== 'custom';
}

function renderAutoPalette() {
  const plan = state.plan;
  if (!plan || !plan.autoColors) { if (state.s.paletteMode === 'auto') $('autoPal').innerHTML = ''; return; }
  $('autoPal').innerHTML = plan.palette.map((p) =>
    `<span class="chip" title="${p.hex}"><b>${p.num}</b><span class="sw" style="background:${p.hex}"></span>${p.used ? '' : '<span class="note">unused</span>'}</span>`).join('');
}

function renderColors() {
  const nums = new Map(numberPalette(state.s.colors, state.s.order).map((p) => [p.from, p.num]));
  const host = $('colorRows');
  host.innerHTML = '';
  state.s.colors.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="num">${nums.get(i)}</td><td><input type="color" value="${c.hex}"></td>` +
      `<td><input type="text" class="hex" value="${c.hex}"></td><td><input type="text" class="name" placeholder="name" value="${escapeHtml(c.name || '')}"></td>` +
      `<td><button title="move up" data-a="up">↑</button><button title="move down" data-a="down">↓</button><button title="remove" data-a="del">✕</button></td>`;
    const [col, hex, name] = tr.querySelectorAll('input');
    col.addEventListener('input', () => { c.hex = col.value; hex.value = col.value; colorsChanged(false); });
    hex.addEventListener('change', () => {
      const h = normalizeHex(hex.value);
      if (h) { c.hex = h; col.value = h; colorsChanged(false); } else hex.value = c.hex;
    });
    name.addEventListener('change', () => { c.name = name.value; colorsChanged(false); });
    for (const b of tr.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        const a = b.dataset.a, list = state.s.colors;
        if (a === 'del') list.splice(i, 1);
        else if (a === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        else if (a === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
        colorsChanged(true);
      });
    }
    host.appendChild(tr);
  });
}

/** After an edit to My colors: re-render the rows (when their order or count changed), warn, re-run. */
function colorsChanged(rerender) {
  if (rerender) renderColors();
  else {
    // the numbers may move when a color's lightness changes
    const nums = numberPalette(state.s.colors, state.s.order);
    const cells = $('colorRows').querySelectorAll('td.num');
    nums.forEach((p) => { if (cells[p.from]) cells[p.from].textContent = p.num; });
  }
  renderWarnings();
  scheduleRun();
}

/** Close colors and unused ones, from the custom list as typed (before a run) or the plan. */
function renderWarnings() {
  const out = [];
  if (state.s.paletteMode === 'custom') {
    const pal = numberPalette(state.s.colors, state.s.order);
    for (const { a, b, dE } of closePairs(pal)) out.push(`Colors ${pal[a].num} and ${pal[b].num} are only ΔE ${dE.toFixed(1)} apart: hard to tell apart as paints.`);
  } else if (state.plan) {
    for (const n of state.plan.notes) if (/apart/.test(n)) out.push(n.charAt(0).toUpperCase() + n.slice(1) + '.');
  }
  if (state.plan) for (const n of state.plan.notes) if (/not used/.test(n)) out.push(n.charAt(0).toUpperCase() + n.slice(1) + '.');
  $('palWarn').textContent = out.join(' ');
}

function bindPalette() {
  for (const b of document.querySelectorAll('#palSeg button')) {
    b.addEventListener('click', () => {
      if (b.dataset.pal === 'custom' && !state.s.colors.length && state.plan) copyAutoToCustom();
      setPaletteMode(b.dataset.pal);
      renderColors();
      renderWarnings();
      scheduleRun(0);
    });
  }
  const showN = () => { $('autoNVal').textContent = $('autoN').value; };
  $('autoN').addEventListener('input', () => { state.s.autoN = parseInt($('autoN').value, 10); showN(); scheduleRun(); });
  $('mergeOn').addEventListener('change', () => { state.s.mergeOn = $('mergeOn').checked; $('mergeDE').disabled = !state.s.mergeOn; scheduleRun(0); });
  $('mergeDE').addEventListener('input', () => { const v = parseFloat($('mergeDE').value); if (v > 0) { state.s.mergeDE = v; scheduleRun(); } });
  $('editAuto').addEventListener('click', () => {
    if (!state.plan) return;
    copyAutoToCustom();
    setPaletteMode('custom');
    renderColors();
    scheduleRun(0);
  });
  // predefined sets: they become My colors
  $('colorSet').innerHTML = COLOR_SETS.map((c) => `<option value="${c.id}">${escapeHtml(c.label)} · ${c.colors.length}</option>`).join('');
  const useSet = (add) => {
    const set = COLOR_SETS.find((c) => c.id === $('colorSet').value);
    if (!set) return;
    // My colors as they stand, whichever mode is showing: Add never drops them
    const mine = state.s.colors.length;
    // Add skips colors already in the list (two sets often share white and black)
    const have = new Set(mine ? state.s.colors.map((c) => c.hex) : []);
    const extra = colorSet(set.id).filter((c) => !have.has(c.hex));
    state.s.colors = add && mine ? [...state.s.colors, ...extra] : colorSet(set.id);
    setPaletteMode('custom');
    colorsChanged(true);
    const skipped = set.colors.length - extra.length;
    setStatus(add && mine ? `${set.label}: ${extra.length} colors added${skipped ? `, ${skipped} already in the list` : ''}` : `${set.label}: ${set.colors.length} colors in use`);
  };
  $('setUse').addEventListener('click', () => useSet(false));
  $('setAdd').addEventListener('click', () => useSet(true));
  $('addColor').addEventListener('click', () => { state.s.colors.push({ hex: '#808080', name: '' }); colorsChanged(true); });
  $('order').addEventListener('change', () => { state.s.order = $('order').value; colorsChanged(true); });
  $('savePal').addEventListener('click', () => {
    downloadFile(JSON.stringify({ app: 'PaintByNumbers', palette: state.s.colors }, null, 1), `${state.imageName}-palette.json`, 'application/json');
  });
  $('loadPal').addEventListener('click', () => $('palFile').click());
  $('palFile').addEventListener('change', async () => {
    const f = $('palFile').files[0];
    $('palFile').value = '';
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      const list = Array.isArray(o) ? o : o.palette;
      if (!Array.isArray(list)) throw new Error('no palette in that file');
      const colors = list.map((c) => (typeof c === 'string' ? { hex: normalizeHex(c), name: '' } : { hex: normalizeHex(c && c.hex), name: String((c && c.name) || '') }))
        .filter((c) => c.hex);
      if (!colors.length) throw new Error('no colors in that file');
      state.s.colors = colors;
      colorsChanged(true);
      setStatus(`${colors.length} colors loaded`);
    } catch (err) {
      setStatus(`could not load the palette: ${err.message}`, 'bad');
    }
  });
}

function copyAutoToCustom() {
  state.s.colors = state.plan.palette.map((p) => ({ hex: p.hex, name: p.name || '' }));
  state.s.order = 'light';
  $('order').value = 'light';
}

// ------------------------------------------------------- sample from a photo
// (Photo2Mosaic's tile sampler, for paints.)
const photo = { data: null, w: 0, h: 0, target: -1, picked: null };

function renderPhotoTargets() {
  const sel = $('photoTarget');
  const nums = new Map(numberPalette(state.s.colors, state.s.order).map((p) => [p.from, p.num]));
  sel.innerHTML = state.s.colors.map((c, i) => `<option value="${i}">${nums.get(i)} ${escapeHtml(c.name || c.hex)}</option>`).join('');
  if (photo.target >= 0) sel.value = String(photo.target);
}

function bindPhoto() {
  $('samplePhoto').addEventListener('click', () => {
    renderPhotoTargets();
    $('photoDlg').showModal();
    if (!photo.data) $('photoFile').click();
  });
  $('photoLoad').addEventListener('click', () => $('photoFile').click());
  $('photoFile').addEventListener('change', async () => {
    const f = $('photoFile').files[0];
    $('photoFile').value = '';
    if (!f) return;
    let img;
    try { img = await loadFile(f, 2000); } catch (err) { $('photoHex').textContent = `${err.message} (${f.name})`; return; }
    $('photoHex').textContent = 'click a color';
    const c = $('photoCanvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    photo.data = img.data; photo.w = img.width; photo.h = img.height;
  });
  const showR = () => { $('photoRadiusVal').textContent = $('photoRadius').value; };
  $('photoRadius').addEventListener('input', showR);
  showR();
  $('photoCanvas').addEventListener('click', (e) => {
    if (!photo.data) return;
    const c = $('photoCanvas'), r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width, y = ((e.clientY - r.top) / r.height) * c.height;
    const R = parseInt($('photoRadius').value, 10);
    const sum = [0, 0, 0];
    let n = 0;
    for (let yy = Math.max(0, Math.round(y - R)); yy <= Math.min(photo.h - 1, Math.round(y + R)); yy++) {
      for (let xx = Math.max(0, Math.round(x - R)); xx <= Math.min(photo.w - 1, Math.round(x + R)); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > R * R) continue;
        const q = 4 * (yy * photo.w + xx);
        for (let k = 0; k < 3; k++) sum[k] += LINEAR_LUT[photo.data[q + k]];
        n++;
      }
    }
    if (!n) return;
    photo.picked = linearToHex(sum.map((v) => v / n));
    $('photoSwatch').style.background = photo.picked;
    $('photoHex').textContent = photo.picked;
    $('photoApply').disabled = !state.s.colors.length;
    $('photoAdd').disabled = false;
  });
  $('photoApply').addEventListener('click', () => {
    const i = parseInt($('photoTarget').value, 10);
    const c = state.s.colors[i];
    if (!c || !photo.picked) return;
    c.hex = photo.picked;
    photo.target = i;
    colorsChanged(true);
  });
  $('photoAdd').addEventListener('click', () => {
    if (!photo.picked) return;
    state.s.colors.push({ hex: photo.picked, name: '' });
    photo.target = state.s.colors.length - 1;
    colorsChanged(true);
    renderPhotoTargets();
    $('photoApply').disabled = false;
  });
  $('photoClose').addEventListener('click', () => $('photoDlg').close());
}

// ---------------------------------------------------------- colors from image
/**
 * The same colors "From the image" would give: clustered from the image after
 * Tone and Style (the worker's last styled raster), merged as set in Palette.
 * Before the first run there is no styled raster yet, so Tone only.
 */
function dialogPalette() {
  if (!state.rgba) return [];
  const n = Math.max(2, Math.min(40, parseInt($('palN').value, 10) || 16));
  let src;
  if (state.styled) {
    const c = state.styled;
    src = { width: c.width, height: c.height, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  } else src = applyTone(state.rgba, num('gamma'), num('brightness'), num('saturation'));
  return autoPalette(src, n, 1, state.s.mergeOn ? state.s.mergeDE : 0);
}

function renderDialogPalette() {
  const pal = dialogPalette();
  $('palSwatches').innerHTML = pal.map((q) =>
    `<div class="palswatch"><span class="chip" style="background:${q.hex}"></span><span>${q.hex}<br>${(100 * q.share).toFixed(1)}%</span></div>`).join('');
  return pal;
}

function bindFromImage() {
  $('fromImage').addEventListener('click', () => {
    if (!state.rgba) return;
    renderDialogPalette();
    $('paletteDlg').showModal();
  });
  let timer = null;
  $('palN').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderDialogPalette, 150); });
  $('palApply').addEventListener('click', () => {
    clearTimeout(timer);
    const pal = renderDialogPalette().map((q) => ({ hex: q.hex, name: '' }));
    if (!pal.length) return;
    if ($('palMode').value === 'add') state.s.colors.push(...pal);
    else state.s.colors = pal;
    $('paletteDlg').close();
    colorsChanged(true);
    setStatus(`${pal.length} colors from the image`);
  });
  $('palClose').addEventListener('click', () => $('paletteDlg').close());
}

// ------------------------------------------------------------------- paint
const MAX_BACKING = 8192;

/** Canvas sized for the view; returns the px-per-mm transform. */
function sizeCanvas(plan) {
  const canvas = $('view');
  const stage = $('stage');
  const { W, H } = plan.piece;
  const fit = Math.min((stage.clientWidth - 28) / W, (stage.clientHeight - 28) / H);
  const zoom = parseFloat($('zoom').value) || 1;
  let cssPerMm = Math.max(0.05, fit * zoom);
  const dpr = window.devicePixelRatio || 1;
  let k = cssPerMm * dpr;
  if (Math.max(W, H) * k > MAX_BACKING) { k = MAX_BACKING / Math.max(W, H); cssPerMm = k / dpr; }
  canvas.width = Math.max(1, Math.round(W * k));
  canvas.height = Math.max(1, Math.round(H * k));
  canvas.style.width = `${Math.round(W * cssPerMm)}px`;
  canvas.style.height = `${Math.round(H * cssPerMm)}px`;
  return { k, cssPerMm };
}

/** Region paths, cached on the plan (they do not change between paints). */
function regionPath(r) {
  if (!r._path) {
    const p = new Path2D();
    for (const ring of r.rings) {
      p.moveTo(ring[0], ring[1]);
      for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i], ring[i + 1]);
      p.closePath();
    }
    Object.defineProperty(r, '_path', { value: p, enumerable: false });
  }
  return r._path;
}

function chainsPath(plan) {
  if (!plan._chains) {
    const p = new Path2D();
    for (const c of plan.chains) {
      p.moveTo(c.pts[0], c.pts[1]);
      for (let i = 2; i < c.pts.length; i += 2) p.lineTo(c.pts[i], c.pts[i + 1]);
      if (c.closed) p.closePath();
    }
    Object.defineProperty(plan, '_chains', { value: p, enumerable: false });
  }
  return plan._chains;
}

function drawPainted(ctx, plan, k) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.8 / k;   // its own color round each region: no hairline seams between neighbours
  for (const r of plan.regions) {
    const c = plan.palette[r.c].hex;
    ctx.fillStyle = c; ctx.strokeStyle = c;
    const p = regionPath(r);
    ctx.fill(p, 'evenodd');
    ctx.stroke(p);
  }
}

/**
 * The image under the design. `styled` (the default): after Tone and the Style
 * chain, as its colors are matched; otherwise after Tone only, the image the
 * Difference view and the ΔE figures compare against.
 */
function drawSource(ctx, plan, styled = true) {
  const R = plan.imageRect;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.piece.W, plan.piece.H);
  if (styled && state.styled) ctx.drawImage(state.styled, 0, 0, plan.piece.W, plan.piece.H);
  else if (state.toned) ctx.drawImage(state.toned, R.x, R.y, R.w, R.h);
}

/** Lines, then numbers and leaders, as the pattern prints them. */
function drawLines(ctx, plan, k, ink) {
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(state.s.lineWidth, 0.7 / k);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke(chainsPath(plan));
}

function drawNumbers(ctx, plan, k, ink, filter = null) {
  const lw = Math.max(0.08, 0.6 * state.s.lineWidth, 0.6 / k);
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = lw;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';   // placed as the SVG places them (svg.js BASELINE)
  for (const r of plan.regions) {
    const l = r.label;
    if (filter && !filter(r)) continue;
    if (l.leader) {
      const [x0, y0] = leaderStart(l);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(l.leader.x, l.leader.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(l.leader.x, l.leader.y, Math.max(0.2, 1.2 * lw), 0, 2 * Math.PI); ctx.fill();
    }
    ctx.font = `${l.size}px ${FONT}`;
    ctx.fillText(l.text, l.x, l.y + BASELINE * l.size);
  }
}

function drawPattern(ctx, plan, k) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.piece.W, plan.piece.H);
  drawLines(ctx, plan, k, inkHex(state.disp.lineDark));
  if (state.disp.numbers) drawNumbers(ctx, plan, k, inkHex(state.disp.numDark));
  drawGrid(ctx, plan, k);
}

/** The pencil grid (core/grid.js), when it is on. */
function drawGrid(ctx, plan, k) {
  const sp = state.disp.grid ? state.disp.gridMm : 0;
  if (!(sp > 0)) return;
  const { W, H } = plan.piece;
  const { xs, ys } = gridLines(W, H, sp);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = Math.max(0.15, 0.8 / k);
  ctx.beginPath();
  for (const x of xs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (const y of ys) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  const fs = Math.max(gridFont(sp), 9 / k);   // readable on screen at any zoom
  const L = gridLabels(W, H, sp, { x0: 0, y0: 0, x1: W, y1: H });
  ctx.fillStyle = GRID_COLOR;
  ctx.font = `bold ${fs}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (const c of L.cols) ctx.fillText(c.text, c.x, 0.4 * fs + 0.72 * fs);
  for (const r of L.rows) ctx.fillText(r.text, 0.4 * fs + 0.6 * fs, r.y + 0.36 * fs);
}

/** ΔE between the painted design and the image, per screen pixel: white on target, amber about 10, dark red 20+. */
function drawDiff(ctx, plan, k) {
  const c = ctx.canvas, w = c.width, h = c.height;
  drawPainted(ctx, plan, k);
  const a = ctx.getImageData(0, 0, w, h).data;
  drawSource(ctx, plan, false);
  const img = ctx.getImageData(0, 0, w, h);
  const b = img.data;
  for (let i = 0; i < w * h; i++) {
    const q = 4 * i;
    const p1 = rgbToOKLab(LINEAR_LUT[a[q]], LINEAR_LUT[a[q + 1]], LINEAR_LUT[a[q + 2]]);
    const p2 = rgbToOKLab(LINEAR_LUT[b[q]], LINEAR_LUT[b[q + 1]], LINEAR_LUT[b[q + 2]]);
    const dE = 100 * Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
    const [r, g, bl] = diffColor(Math.min(1, dE / 20));
    b[q] = r; b[q + 1] = g; b[q + 2] = bl; b[q + 3] = 255;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
  drawLines(ctx, plan, k, '#00000030');
}

function diffColor(u) {
  // white -> amber -> dark red
  if (u < 0.5) { const t = u / 0.5; return [255, 255 - 80 * t, 255 - 220 * t]; }
  const t = (u - 0.5) / 0.5;
  return [255 - 115 * t, 175 - 165 * t, 35 - 25 * t];
}

function drawProblems(ctx, plan, k) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.piece.W, plan.piece.H);
  ctx.globalAlpha = 0.3;
  drawPainted(ctx, plan, k);
  ctx.globalAlpha = 1;
  const mark = (r, color) => { ctx.fillStyle = color; ctx.fill(regionPath(r), 'evenodd'); };
  for (const r of plan.regions) {
    if (r.label.crowded) mark(r, '#e0303099');
    else if (r.label.leader) mark(r, '#ff9a1a99');
  }
  drawLines(ctx, plan, k, '#555555');
  drawNumbers(ctx, plan, k, '#000000');
}

/** Draw a view onto a context already scaled to mm. */
function drawView(ctx, plan, view, k) {
  if (view === 'painted') drawPainted(ctx, plan, k);
  else if (view === 'pattern') drawPattern(ctx, plan, k);
  else if (view === 'source') drawSource(ctx, plan);
  else if (view === 'overlay') {
    drawSource(ctx, plan);
    ctx.fillStyle = '#ffffff55';
    ctx.fillRect(0, 0, plan.piece.W, plan.piece.H);
    drawLines(ctx, plan, k, '#000000cc');
    if (state.disp.numbers) drawNumbers(ctx, plan, k, '#000000');
    drawGrid(ctx, plan, k);
  } else if (view === 'diff') drawDiff(ctx, plan, k);
  else if (view === 'problems') drawProblems(ctx, plan, k);
  if (state.selColor >= 0 && view !== 'source' && view !== 'diff') {
    ctx.strokeStyle = '#ff00cc';
    ctx.lineWidth = Math.max(0.5, 2.5 / k);
    for (const r of plan.regions) if (r.c === state.selColor) ctx.stroke(regionPath(r));
  }
}

const HINTS = {
  painted: 'the design painted: every region in its color',
  pattern: 'the printable pattern: lines and numbers, as they print',
  overlay: 'the pattern over the image',
  source: 'the image after Tone and Style, as its colors are matched',
  diff: 'ΔE between the painted colors and the image (after Tone, before Style): white = on target, amber ≈ 10, dark red = 20 or more',
  problems: 'orange: number outside on a leader · red: crowded, no room anywhere',
};

function paint() {
  const plan = state.plan;
  if (!plan) return;
  const { k } = sizeCanvas(plan);
  const ctx = $('view').getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawView(ctx, plan, state.view, k);
  $('hint').textContent = HINTS[state.view] || '';
}

function setView(v) {
  state.view = v;
  for (const b of document.querySelectorAll('#viewSeg button')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  paint();
}

// --------------------------------------------------------------- hover
function buildHit(plan) {
  const cell = Math.max(plan.piece.W, plan.piece.H) / 64;
  const grid = new Map();
  plan.regions.forEach((r, i) => {
    const [x0, y0, x1, y1] = r.bbox;
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });
  return { cell, grid };
}

function regionAt(x, y) {
  const plan = state.plan, H = state.hitGrid;
  if (!plan || !H) return -1;
  for (const i of H.grid.get(`${Math.floor(x / H.cell)},${Math.floor(y / H.cell)}`) || []) {
    const r = plan.regions[i];
    if (x < r.bbox[0] || x > r.bbox[2] || y < r.bbox[1] || y > r.bbox[3]) continue;
    if (inRings(x, y, r.rings)) return i;
  }
  return -1;
}

function bindHover() {
  const canvas = $('view');
  const at = (e) => {
    const r = canvas.getBoundingClientRect(), plan = state.plan;
    return [((e.clientX - r.left) / r.width) * plan.piece.W, ((e.clientY - r.top) / r.height) * plan.piece.H];
  };
  canvas.addEventListener('mousemove', (e) => {
    if (!state.plan) return;
    const i = regionAt(...at(e));
    if (i < 0) { $('hint').textContent = HINTS[state.view] || ''; return; }
    const r = state.plan.regions[i], p = state.plan.palette[r.c];
    const l = r.label;
    $('hint').textContent = `region ${i + 1}: color ${p.num}${p.name ? ` (${p.name})` : ''} ${p.hex} · ${areaText(r.area, state.units)} · ` +
      `number ${(l.size * 72 / 25.4).toFixed(1)} pt${l.leader ? ', outside on a leader' : ''}${l.crowded ? ', crowded' : ''} · ΔE ${r.dE.toFixed(1)}`;
  });
  canvas.addEventListener('mouseleave', () => { $('hint').textContent = HINTS[state.view] || ''; });
  canvas.addEventListener('click', (e) => {
    if (!state.plan) return;
    const i = regionAt(...at(e));
    selectColor(i < 0 ? -1 : state.plan.regions[i].c === state.selColor ? -1 : state.plan.regions[i].c);
  });
}

function selectColor(c) {
  state.selColor = c;
  renderKey();
  paint();
}

// ------------------------------------------------------------------- stats
function setStat(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = cls;
}

function updateStats() {
  const plan = state.plan;
  if (!plan) return;
  const st = plan.stats;
  setStat('statRegions', String(st.regions));
  setStat('statColors', `${st.colors} of ${plan.palette.length}`);
  setStat('statPiece', `${fmtLen(plan.piece.W, state.units)} × ${fmtLen(plan.piece.H, state.units)} ${unitLabel()}`);
  setStat('statMean', st.meanDE.toFixed(1), st.meanDE > 10 ? 'warn' : '');
  setStat('statLeaders', st.crowded ? `${st.leaders} · ${st.crowded} crowded` : String(st.leaders), st.crowded ? 'bad' : st.leaders ? 'warn' : '');
}

function renderKey() {
  const plan = state.plan;
  if (!plan) return;
  const { W, H } = plan.piece;
  const cov = state.disp.coverage;
  const rows = plan.palette.map((p, i) =>
    `<tr data-c="${i}" class="${p.used ? '' : 'off'}${i === state.selColor ? ' hot' : ''}" title="click: outline its regions">` +
    `<td><b>${p.num}</b></td><td><span class="sw" style="background:${p.hex}"></span></td>` +
    `<td>${escapeHtml(p.name || p.hex)}</td><td>${p.regions}</td><td>${areaText(p.area, state.units)}</td>` +
    `<td>${((100 * p.area) / (W * H)).toFixed(1)}%</td><td>${p.used ? paintMl(p.area, cov).toFixed(1) : '—'}</td></tr>`).join('');
  $('key').innerHTML = '<thead><tr><th>#</th><th></th><th>Color</th><th>Regions</th><th>Area</th><th>Share</th><th>ml</th></tr></thead>' +
    `<tbody>${rows}</tbody>`;
  for (const tr of $('key').querySelectorAll('tbody tr')) {
    tr.addEventListener('click', () => { const c = parseInt(tr.dataset.c, 10); selectColor(state.selColor === c ? -1 : c); });
  }
}

// ------------------------------------------------------------------ export
const fileBase = () => state.imageName;

function bindExports() {
  const look = () => ({ lineWidth: state.s.lineWidth, lineDark: state.disp.lineDark, numDark: state.disp.numDark, numbers: state.disp.numbers,
    grid: state.disp.grid ? state.disp.gridMm : 0 });
  $('exportPattern').addEventListener('click', () => {
    if (state.plan) downloadFile(patternSVG(state.plan, { ...look(), title: state.imageName }), `${fileBase()}-pattern.svg`, 'image/svg+xml');
  });
  $('exportPainted').addEventListener('click', () => {
    if (state.plan) downloadFile(paintedSVG(state.plan, { title: state.imageName }), `${fileBase()}-painted.svg`, 'image/svg+xml');
  });
  $('exportCsv').addEventListener('click', () => {
    const plan = state.plan;
    if (!plan) return;
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = ['number,hex,name,regions,area_mm2,share_pct,paint_ml'];
    for (const p of plan.palette) {
      lines.push([p.num, p.hex, q(p.name || ''), p.regions, p.area.toFixed(1), ((100 * p.area) / (plan.piece.W * plan.piece.H)).toFixed(2), paintMl(p.area, state.disp.coverage).toFixed(2)].join(','));
    }
    downloadFile(lines.join('\n') + '\n', `${fileBase()}-key.csv`, 'text/csv');
  });
  $('exportPng').addEventListener('click', () => {
    if (!state.plan) return;
    const a = document.createElement('a');
    a.href = renderPNG(state.plan, state.view, 2400);
    a.download = `${fileBase()}-${state.view}.png`;
    a.click();
  });
  $('printPlan').addEventListener('click', () => {
    if (!state.plan) return;
    updatePrintNote();
    $('printDlg').showModal();
  });
  for (const id of ['paper', 'pSummary', 'pFit', 'pPattern']) $(id).addEventListener('change', updatePrintNote);
  $('pPattern').addEventListener('change', () => { $('pNumbers').disabled = !$('pPattern').checked; });
  $('printClose').addEventListener('click', () => $('printDlg').close());
  $('printGo').addEventListener('click', () => {
    const plan = state.plan;
    if (!plan) return;
    const html = planHTML(plan, {
      paper: $('paper').value, units: state.units, title: `${state.imageName} — paint by numbers`,
      summary: $('pSummary').checked, fit: $('pFit').checked, pattern: $('pPattern').checked, numbers1to1: $('pNumbers').checked,
      previewURL: renderPNG(plan, 'painted', 1400), display: look(), coverage: state.disp.coverage, grid: look().grid,
    });
    const w = window.open('', '_blank');
    if (!w) { setStatus('the browser blocked the new window: allow pop-ups for this page', 'bad'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    $('printDlg').close();
  });
}

function updatePrintNote() {
  const plan = state.plan;
  if (!plan) return;
  const room = printable(PAPERS[$('paper').value]);
  const pw = pageWindows(plan.piece.W, plan.piece.H, room.w, room.h);
  const pages = ($('pSummary').checked ? 1 : 0) + ($('pFit').checked ? 1 : 0) + ($('pPattern').checked ? pw.windows.length : 0);
  $('printNote').textContent = `${pages} pages${$('pPattern').checked ? ` (the 1:1 pattern on ${pw.rows} × ${pw.cols})` : ''}. ` +
    'Print at 100% (actual size): each 1:1 page has a 50 mm bar to check.';
}

function renderPNG(plan, view, maxPx) {
  const k = maxPx / Math.max(plan.piece.W, plan.piece.H);
  const c = document.createElement('canvas');
  c.width = Math.round(plan.piece.W * k);
  c.height = Math.round(plan.piece.H * k);
  const ctx = c.getContext('2d', { willReadFrequently: view === 'diff' });
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawView(ctx, plan, view, k);
  return c.toDataURL('image/png');
}

// ------------------------------------------------------------------- image
/** Pixels from a URL, the longest side capped at maxDim. */
function loadImage(url, maxDim = 4000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h);
      resolve({ width: w, height: h, data: d.data });
    };
    img.onerror = () => reject(new Error('could not read that image'));
    img.src = url;
  });
}

function setImage(rgba, name, src) {
  state.rgba = rgba;
  state.imageName = name;
  state.imageSrc = src;
  state.imageKey++;
  state.styled = null;
  state.selColor = -1;
  if (state.preset !== 'custom') { applyPreset(); showLengths(); }
  updateToned();
  run();
}

/** The toned image as a canvas, for the Source and Overlay views. */
function updateToned() {
  if (!state.rgba) return;
  const t = applyTone(state.rgba, num('gamma'), num('brightness'), num('saturation'));
  const c = document.createElement('canvas');
  c.width = t.width; c.height = t.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.data), t.width, t.height), 0, 0);
  state.toned = c;
}

async function loadSample(kind) {
  if (kind === 'monalisa' || kind === 'rhino') {
    try { setImage(await loadImage(`assets/${kind}.jpg`), kind, { kind: 'sample', name: kind }); return; } catch { kind = 'sphere'; }
  }
  setImage(generateSample(kind).color, kind, { kind: 'sample', name: kind });
}

function bindImage() {
  const drop = $('drop');
  drop.addEventListener('click', () => $('file').click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
  });
  $('file').addEventListener('change', () => { const f = $('file').files[0]; if (f) openFile(f); $('file').value = ''; });
  for (const b of document.querySelectorAll('[data-sample]')) b.addEventListener('click', () => loadSample(b.dataset.sample));
}

/** loadImage on a File, releasing its object URL afterwards, read or not. */
async function loadFile(f, maxDim) {
  const url = URL.createObjectURL(f);
  try { return await loadImage(url, maxDim); } finally { URL.revokeObjectURL(url); }
}

async function openFile(f) {
  try {
    // the original bytes, kept for projects: a re-encode could move boundaries
    const dataURL = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('could not read that file'));
      r.readAsDataURL(f);
    });
    setImage(await loadImage(dataURL), f.name.replace(/\.[^.]+$/, '') || 'design', { kind: 'file', name: f.name, dataURL });
  } catch (err) {
    setStatus(err.message, 'bad');
  }
}

// ----------------------------------------------------------------- projects
function collectProject() {
  return { image: state.imageSrc, units: state.units, settings: state.s, display: state.disp };
}

/** Every control from settings (no image): opening a project, Reset, start-up. */
function applySettings(units, s, disp) {
  state.units = units;
  state.s = s;
  state.disp = disp;
  showLengths();
  for (const k of ['gamma', 'brightness', 'saturation']) {
    $(k).value = s[k];
    $(`${k}Val`).textContent = Number(s[k]).toFixed(2);
  }
  $('precision').value = s.precision;
  $('autoN').value = s.autoN;
  $('autoNVal').textContent = s.autoN;
  $('mergeOn').checked = s.mergeOn;
  $('targetOn').checked = s.targetOn;
  $('target').value = s.target;
  renderTargetNote();
  $('mergeDE').value = s.mergeDE;
  $('mergeDE').disabled = !s.mergeOn;
  buildStyleUI();
  $('order').value = s.order;
  setPaletteMode(s.paletteMode);
  renderColors();
  $('lineDark').value = Math.round(100 * disp.lineDark);
  $('lineDarkVal').textContent = `${Math.round(100 * disp.lineDark)}%`;
  $('numDark').value = Math.round(100 * disp.numDark);
  $('numDarkVal').textContent = `${Math.round(100 * disp.numDark)}%`;
  $('numbers').checked = disp.numbers;
  $('grid').checked = disp.grid;
  $('coverage').value = disp.coverage;
  $('preset').value = state.preset;
  renderWarnings();
  save();
}

async function applyProject(p, problems) {
  state.preset = 'custom';
  applySettings(p.units, p.settings, p.display);
  const note = () => (problems.length ? ` (with problems: ${problems.join('; ')})` : '');
  if (!p.image) { run(); setStatus(`project opened without an image${note()}`, 'warn'); return; }
  if (p.image.kind === 'sample') await loadSample(p.image.name);
  else setImage(await loadImage(p.image.dataURL), p.image.name.replace(/\.[^.]+$/, '') || 'design', p.image);
  if (problems.length) setStatus(`project opened${note()}`, 'warn');
}

function resetControls() {
  if (!window.confirm('Reset every control to its default?\n\nThe image stays. My colors are cleared too: save the palette or a project first to keep them.')) return;
  state.preset = 'custom';
  applySettings('mm', freshSettings(), { ...DISPLAY });
  state.selColor = -1;
  $('zoom').value = '1';
  setView('painted');
  updateToned();
  run();
  setStatus('every control reset to its default');
}

function bindProjects() {
  $('resetAll').addEventListener('click', resetControls);
  $('saveProject').addEventListener('click', () => {
    if (!state.imageSrc) return;
    downloadFile(projectJSON(collectProject()), `${state.imageName}.pbn.json`, 'application/json');
  });
  $('openProject').addEventListener('click', () => $('projectFile').click());
  $('projectFile').addEventListener('change', async () => {
    const f = $('projectFile').files[0];
    $('projectFile').value = '';
    if (!f) return;
    try {
      const { project, problems } = parseProject(await f.text());
      await applyProject(project, problems);
    } catch (err) {
      setStatus(`could not open the project: ${err.message}`, 'bad');
    }
  });
}

// ------------------------------------------------------------------- style
/**
 * The Style section: one card per filter, in chain order -- a tick to use it,
 * up/down to move it, and its own controls while it is on (HalftoneCuttable's).
 * Built from the filter registry (core/style.js).
 */
function buildStyleUI() {
  const host = $('styleChain');
  host.innerHTML = '';
  const { order, on, params } = state.s.style;
  order.forEach((fid, i) => {
    const f = filterById(fid);
    const card = document.createElement('div');
    card.className = `fcard${on[fid] ? ' on' : ''}`;
    card.innerHTML = `<div class="fhead"><label class="check"><input type="checkbox" id="style-${fid}"> ${f.label}</label>` +
      `<button class="mini" data-dir="-1" title="run earlier"${i === 0 ? ' disabled' : ''}>↑</button>` +
      `<button class="mini" data-dir="1" title="run later"${i === order.length - 1 ? ' disabled' : ''}>↓</button></div>` +
      '<div class="fbody"><div class="fparams"></div><p class="note"></p></div>';
    const tick = card.querySelector('input');
    tick.checked = !!on[fid];
    tick.addEventListener('change', () => { on[fid] = tick.checked; buildStyleUI(); showDetailPreset(); scheduleRun(0); });
    for (const b of card.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        const j = i + parseInt(b.dataset.dir, 10);
        [order[i], order[j]] = [order[j], order[i]];
        buildStyleUI();
        if (on[order[i]] && on[order[j]]) scheduleRun(0);
      });
    }
    const fbody = card.querySelector('.fbody');
    fbody.hidden = !on[fid];
    if (on[fid]) {
      renderParams(card.querySelector('.fparams'), f.params, params[fid], `style-${fid}`);
      card.querySelector('.note').textContent = f.blurb;
    }
    host.appendChild(card);
  });
}

/** Range, select or checkbox controls for a filter's params (as HalftoneCuttable's); mm values show in the units. */
function renderParams(host, defs, values, prefix) {
  host.innerHTML = '';
  for (const p of defs) {
    const id = `${prefix}-${p.key}`;
    let el;
    if (p.type === 'checkbox') {
      el = document.createElement('label');
      el.className = 'check';
      el.innerHTML = `<input type="checkbox" id="${id}"> ${p.label}`;
      const input = el.querySelector('input');
      input.checked = !!values[p.key];
      input.addEventListener('change', () => { values[p.key] = input.checked; scheduleRun(); });
    } else if (p.type === 'select') {
      el = document.createElement('div');
      el.className = 'row';
      el.innerHTML = `<label for="${id}">${p.label}</label><select id="${id}">` +
        p.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') + '</select>';
      const input = el.querySelector('select');
      input.value = values[p.key];
      input.addEventListener('change', () => { values[p.key] = input.value; scheduleRun(); });
    } else {
      el = document.createElement('div');
      el.className = 'row';
      el.innerHTML = `<label for="${id}">${p.label}</label>` +
        `<input type="range" id="${id}" min="${p.min}" max="${p.max}" step="${p.step}"><span class="val"></span>`;
      const input = el.querySelector('input'), val = el.querySelector('.val');
      const dp = p.dp ?? (p.step >= 1 ? 0 : 2);
      const show = () => {
        const v = Number(input.value);
        val.textContent = p.unit === 'mm' && state.units === 'in' ? `${(v / 25.4).toFixed(3)} in` : v.toFixed(dp) + (p.unit ? ` ${p.unit}` : '');
      };
      input.value = values[p.key];
      show();
      input.addEventListener('input', () => { values[p.key] = parseFloat(input.value); show(); showDetailPreset(); scheduleRun(); });
    }
    if (p.hint) el.title = p.hint;
    host.appendChild(el);
  }
}

// ------------------------------------------------------------------- misc
function setStatus(text, cls = '') {
  const el = $('status');
  el.textContent = text;
  el.className = cls;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bindTone() {
  for (const id of ['gamma', 'brightness', 'saturation']) {
    const input = $(id), val = $(`${id}Val`);
    input.addEventListener('input', () => { val.textContent = parseFloat(input.value).toFixed(2); updateToned(); scheduleRun(); });
  }
}

function bindDisplay() {
  for (const id of ['lineDark', 'numDark']) {
    $(id).addEventListener('input', () => {
      state.disp[id] = parseInt($(id).value, 10) / 100;
      $(`${id}Val`).textContent = `${$(id).value}%`;
      save();
      paint();
    });
  }
  $('numbers').addEventListener('change', () => { state.disp.numbers = $('numbers').checked; save(); paint(); });
  $('grid').addEventListener('change', () => { state.disp.grid = $('grid').checked; save(); paint(); });
  $('gridMm').addEventListener('input', () => {
    const v = toMm(parseFloat($('gridMm').value), state.units);
    if (v >= 2) { state.disp.gridMm = v; save(); paint(); }
  });
  $('coverage').addEventListener('input', () => {
    const v = parseFloat($('coverage').value);
    if (v > 0) { state.disp.coverage = v; save(); renderKey(); }
  });
}

function bindViews() {
  for (const b of document.querySelectorAll('#viewSeg button')) b.addEventListener('click', () => setView(b.dataset.view));
  $('zoom').addEventListener('change', paint);
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(paint, 120); });
}

function init() {
  restore();
  buildPresets();
  applySettings(state.units, state.s, state.disp);
  bindLengths();
  bindPalette();
  bindPhoto();
  bindFromImage();
  bindTone();
  bindDisplay();
  bindViews();
  bindHover();
  bindExports();
  bindImage();
  bindProjects();
  loadSample('monalisa');
}

init();
