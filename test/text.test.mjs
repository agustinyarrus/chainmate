/**
 * Text shaping vs the original engine (oracle probes `fonts` and `text`): metrics for every size 6–100,
 * glyph ids and advances glyph by glyph, and `get_string_size` for the whole game corpus at 22 sizes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as hb from 'harfbuzzjs';
import { FontFile, FontVariation } from '../src/godot/text/shaper.js';
import { loadOracle, ofKind } from './oracle.mjs';

const FONT_DIR = new URL('../public/fonts/', import.meta.url);
const file = (name) => new FontFile(hb, name, new Uint8Array(readFileSync(new URL(name, FONT_DIR))));
const cinzel = file('Cinzel-Variable.ttf');
const cormorant = file('CormorantGaramond-Variable.ttf');
const cormorantItalic = file('CormorantGaramond-Italic-Variable.ttf');

/** UiTheme._build(): the six FontVariations of the game. */
const FONTS = {
  display: new FontVariation(cinzel, { variation: { wght: 600 }, spacingGlyph: 1 }),
  caps: new FontVariation(cinzel, { variation: { wght: 560 }, spacingGlyph: 3 }),
  body: new FontVariation(cormorant, { variation: { wght: 520 } }),
  bold: new FontVariation(cormorant, { variation: { wght: 700 } }),
  italic: new FontVariation(cormorantItalic, { variation: { wght: 500 } }),
  numbers: new FontVariation(cormorant, { variation: { wght: 600 }, features: { lnum: 1, tnum: 1 } }),
};

const fontsOracle = loadOracle('fonts');
const textOracle = loadOracle('text');
const corpus = JSON.parse(readFileSync(new URL('../_oracle/font_corpus.json', import.meta.url), 'utf8'));

test('ascent / descent / height match the engine for sizes 6–100', () => {
  let checked = 0;
  for (const entry of ofKind(fontsOracle, 'metrics')) {
    const font = FONTS[entry.font];
    for (const [size, ascent, descent, height] of entry.rows) {
      assert.equal(font.get_ascent(size), ascent, `${entry.font} ascent @${size}`);
      assert.equal(font.get_descent(size), descent, `${entry.font} descent @${size}`);
      assert.equal(font.get_height(size), height, `${entry.font} height @${size}`);
      checked++;
    }
  }
  assert.ok(checked >= 6 * 95);
});

test('glyph ids and advances match TextServerAdvanced glyph by glyph', () => {
  const report = [];
  for (const entry of ofKind(textOracle, 'shaped')) {
    const font = FONTS[entry.font];
    let glyphs = 0;
    const misses = [];
    entry.rows.forEach(([ids, advances], i) => {
      const shaped = font.shape(corpus.strings[i], entry.size);
      assert.deepEqual(shaped.glyphs.map((g) => g.gid), ids, `${entry.font}@${entry.size} glyphs of ${JSON.stringify(corpus.strings[i])}`);
      shaped.glyphs.forEach((g, k) => {
        glyphs++;
        if (Math.abs(g.advance - advances[k]) > 1e-9) misses.push(`${JSON.stringify(corpus.strings[i])}[${k}] ${g.advance} ≠ ${advances[k]}`);
      });
    });
    report.push(`${entry.font}@${entry.size}: ${glyphs - misses.length}/${glyphs}`);
    assert.deepEqual(misses.slice(0, 5), [], `${entry.font}@${entry.size}`);
  }
  console.log(`    ${report.join('  ')}`);
});

test('get_string_size widths match for the whole corpus at 22 sizes × 6 fonts', () => {
  let total = 0;
  const misses = [];
  for (const entry of ofKind(fontsOracle, 'strings')) {
    const font = FONTS[entry.font];
    corpus.strings.forEach((text, i) => {
      total++;
      const width = font.get_string_size(text, entry.size).x;
      if (Math.abs(width - entry.w[i]) > 1e-9) misses.push(`${entry.font}@${entry.size} ${JSON.stringify(text)} ${width} ≠ ${entry.w[i]}`);
    });
  }
  assert.deepEqual(misses.slice(0, 8), [], `${misses.length} of ${total} widths differ`);
});
