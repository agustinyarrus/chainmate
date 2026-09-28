/**
 * Glyph bitmaps — the rasterizer (FreeType + HarfBuzz in WebAssembly) must reproduce the original's
 * glyph cache bit for bit: every glyph the shaper produces for the corpus, six fonts, 24 sizes, every
 * sub-pixel variant, plus the outlined glyphs of the floating texts (_oracle/probe_glyphs.gd).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { loadOracle, ofKind } from './oracle.mjs';
import { loadRasterizer } from '../src/godot/text/ftw.js';

const FONT_DIR = new URL('../public/fonts/', import.meta.url);
const FILES = { cinzel: 'Cinzel-Variable.ttf', cormorant: 'CormorantGaramond-Variable.ttf', italic: 'CormorantGaramond-Italic-Variable.ttf' };
const FONTS = {
  display: { file: 'cinzel', variation: { wght: 600 } },
  caps: { file: 'cinzel', variation: { wght: 560 } },
  body: { file: 'cormorant', variation: { wght: 520 } },
  bold: { file: 'cormorant', variation: { wght: 700 } },
  italic: { file: 'italic', variation: { wght: 500 } },
  numbers: { file: 'cormorant', variation: { wght: 600 } },
};
/** The atlas rectangle carries this transparent margin on every side (rect_range = 1). */
const MARGIN = 1;
const QUARTER_MAX = 16;
const HALF_MAX = 20;

const bytes = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, new Uint8Array(readFileSync(new URL(name, FONT_DIR)))]));
const ft = await loadRasterizer();
const faces = Object.fromEntries(Object.entries(FONTS).map(([name, font]) => [name, ft.openFace(bytes[font.file], { variation: font.variation })]));

const shiftOf = (size, variant) => (size <= QUARTER_MAX ? variant << 4 : size <= HALF_MAX ? variant << 5 : 0);

/** Compares one oracle entry; returns { glyphs, mismatches: [description…] }. */
function compare(entry) {
  const data = inflateSync(Buffer.from(entry.data, 'base64'));
  assert.equal(data.length, entry.bytes, 'oracle data length');
  const mismatches = [];
  let at = 0;
  for (const [glyph, variant, offX, offY, w, h, length] of entry.rows) {
    const expected = data.subarray(at, at + length);
    at += length;
    const bitmap = ft.render(faces[entry.font], entry.size * 64, entry.outline, glyph, shiftOf(entry.size, variant));
    const where = `${entry.font}@${entry.size}${entry.outline ? `+${entry.outline}` : ''} glyph ${glyph} variant ${variant}`;
    if (bitmap === null) {
      mismatches.push(`${where}: not rendered`);
      continue;
    }
    if (length === 0) {
      if (bitmap.width * bitmap.rows !== 0) mismatches.push(`${where}: expected empty, got ${bitmap.width}x${bitmap.rows}`);
      continue;
    }
    if (bitmap.width + 2 * MARGIN !== w || bitmap.rows + 2 * MARGIN !== h) {
      mismatches.push(`${where}: size ${bitmap.width}x${bitmap.rows}, expected ${w - 2 * MARGIN}x${h - 2 * MARGIN}`);
      continue;
    }
    if (bitmap.left - MARGIN !== offX || -bitmap.top - MARGIN !== offY) {
      mismatches.push(`${where}: offset ${bitmap.left - MARGIN},${-bitmap.top - MARGIN}, expected ${offX},${offY}`);
      continue;
    }
    let worst = 0;
    let differing = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= MARGIN && y >= MARGIN && x < w - MARGIN && y < h - MARGIN;
        const actual = inside ? bitmap.pixels[(y - MARGIN) * bitmap.width + (x - MARGIN)] : 0;
        const delta = Math.abs(actual - expected[y * w + x]);
        if (delta > 0) {
          differing += 1;
          worst = Math.max(worst, delta);
        }
      }
    }
    if (differing > 0) mismatches.push(`${where}: ${differing} pixels differ (max ${worst})`);
  }
  return { glyphs: entry.rows.length, mismatches };
}

const entries = ofKind(loadOracle('glyphs'), 'glyphs');

test('the rasterizer is the engine\'s FreeType', () => {
  assert.equal(ft.version, '2.14.3');
});

for (const font of Object.keys(FONTS)) {
  test(`glyph bitmaps of "${font}" match the original bit for bit`, () => {
    const own = entries.filter((entry) => entry.font === font && entry.outline === 0);
    assert.ok(own.length > 0, 'oracle has entries');
    let glyphs = 0;
    const mismatches = [];
    for (const entry of own) {
      const result = compare(entry);
      glyphs += result.glyphs;
      mismatches.push(...result.mismatches);
    }
    console.log(`    ${font}: ${glyphs - mismatches.length}/${glyphs} bitmaps over ${own.length} sizes`);
    assert.deepEqual(mismatches.slice(0, 12), [], `${mismatches.length} of ${glyphs} bitmaps differ`);
  });
}

test('outlined glyphs (floating texts) match the original bit for bit', () => {
  const own = entries.filter((entry) => entry.outline > 0);
  assert.ok(own.length > 0, 'oracle has outlined entries');
  let glyphs = 0;
  const mismatches = [];
  for (const entry of own) {
    const result = compare(entry);
    glyphs += result.glyphs;
    mismatches.push(...result.mismatches);
  }
  console.log(`    outlines: ${glyphs - mismatches.length}/${glyphs} bitmaps over ${own.length} sizes`);
  assert.deepEqual(mismatches.slice(0, 12), [], `${mismatches.length} of ${glyphs} bitmaps differ`);
});
