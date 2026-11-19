// Predefined color sets for My colors: crayon boxes, primaries, greys, and
// paint sets, each color with its name (the name prints in the color key).
//
// The crayon colors are the classic box's published hex values (the 16-pack is
// the 8-pack plus eight). The artist's and earth/skin sets are APPROXIMATE: a
// pigment's color depends on the brand, the binder and how thickly it is laid,
// so they are a starting point to sample real paints against ("Sample from
// photo…"), not a match. The greys are evenly spaced in OKLab lightness, so each
// step looks as far from the next as the eye judges it, not as the numbers do.

import { linearToHex } from './color.js';

/** n neutral greys from white to black, evenly spaced in OKLab lightness (for a grey, L = cbrt(Y)). */
function greys(names) {
  const n = names.length;
  return names.map((name, i) => {
    const L = 1 - i / (n - 1);
    const Y = L * L * L;
    return { hex: linearToHex([Y, Y, Y]), name };
  });
}

const CRAYONS_8 = [
  { hex: '#ee204d', name: 'Red' },
  { hex: '#ff7538', name: 'Orange' },
  { hex: '#fbe870', name: 'Yellow' },
  { hex: '#1cac78', name: 'Green' },
  { hex: '#1f75fe', name: 'Blue' },
  { hex: '#732e6c', name: 'Violet' },
  { hex: '#b4674d', name: 'Brown' },
  { hex: '#232323', name: 'Black' },
];

export const COLOR_SETS = [
  {
    id: 'minimal', label: 'Minimal (RGB + black & white)',
    colors: [
      { hex: '#ff0000', name: 'Red' }, { hex: '#00ff00', name: 'Green' }, { hex: '#0000ff', name: 'Blue' },
      { hex: '#000000', name: 'Black' }, { hex: '#ffffff', name: 'White' },
    ],
  },
  {
    id: 'primaries', label: "Painter's primaries (CMY + black & white)",
    colors: [
      { hex: '#00aeef', name: 'Cyan' }, { hex: '#ec008c', name: 'Magenta' }, { hex: '#fff200', name: 'Yellow' },
      { hex: '#1a1a1a', name: 'Black' }, { hex: '#ffffff', name: 'White' },
    ],
  },
  { id: 'crayons8', label: 'Crayons, 8', colors: CRAYONS_8 },
  {
    id: 'crayons16', label: 'Crayons, 16',
    colors: [
      ...CRAYONS_8,
      { hex: '#ffaacc', name: 'Carnation Pink' },
      { hex: '#ff5349', name: 'Red-Orange' },
      { hex: '#ffae42', name: 'Yellow-Orange' },
      { hex: '#c5e17a', name: 'Yellow-Green' },
      { hex: '#0d98ba', name: 'Blue-Green' },
      { hex: '#7366bd', name: 'Blue-Violet' },
      { hex: '#c0448f', name: 'Red-Violet' },
      { hex: '#ffffff', name: 'White' },
    ],
  },
  {
    id: 'greys', label: 'Greyscale (7)',
    colors: greys(['White', 'Pale grey', 'Light grey', 'Mid grey', 'Dark grey', 'Charcoal', 'Black']),
  },
  {
    id: 'artist', label: "Artist's starter set (approximate)",
    colors: [
      { hex: '#f5f5f0', name: 'Titanium White' },
      { hex: '#fff600', name: 'Cadmium Yellow' },
      { hex: '#cb9d06', name: 'Yellow Ochre' },
      { hex: '#e30022', name: 'Cadmium Red' },
      { hex: '#9b1b30', name: 'Alizarin Crimson' },
      { hex: '#4166f5', name: 'Ultramarine Blue' },
      { hex: '#000f89', name: 'Phthalo Blue' },
      { hex: '#123524', name: 'Phthalo Green' },
      { hex: '#e97451', name: 'Burnt Sienna' },
      { hex: '#8a3324', name: 'Burnt Umber' },
      { hex: '#826644', name: 'Raw Umber' },
      { hex: '#231f20', name: 'Ivory Black' },
    ],
  },
  {
    id: 'earth', label: 'Earth and skin tones (approximate)',
    colors: [
      { hex: '#f7e3d4', name: 'Porcelain' },
      { hex: '#edcbb1', name: 'Ivory' },
      { hex: '#d9a981', name: 'Sand' },
      { hex: '#c68a5c', name: 'Honey' },
      { hex: '#a86b42', name: 'Caramel' },
      { hex: '#8a5232', name: 'Chestnut' },
      { hex: '#5a3825', name: 'Espresso' },
      { hex: '#cb9d06', name: 'Yellow Ochre' },
      { hex: '#6b7a52', name: 'Terre Verte' },
      { hex: '#e97451', name: 'Burnt Sienna' },
      { hex: '#8a3324', name: 'Burnt Umber' },
      { hex: '#c80815', name: 'Venetian Red' },
    ],
  },
];

/** A copy of a set's colors (so editing My colors never edits the set). */
export const colorSet = (id) => {
  const s = COLOR_SETS.find((c) => c.id === id);
  return s ? s.colors.map((c) => ({ ...c })) : [];
};
