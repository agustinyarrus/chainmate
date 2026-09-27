/**
 * The game's fonts — UiTheme._variation() instances over the three shipped variable TTFs:
 *
 *   display  Cinzel             wght 600, spacing_glyph 1
 *   caps     Cinzel             wght 560, spacing_glyph 3
 *   body     Cormorant Garamond wght 520
 *   bold     Cormorant Garamond wght 700
 *   italic   Cormorant Italic   wght 500
 *   numbers  Cormorant Garamond wght 600, lnum + tnum
 *
 * `loadFonts(fetchBytes)` must resolve before anything shapes text; the HarfBuzz WebAssembly module
 * is loaded by the import itself (top-level await in harfbuzzjs).
 */
import * as hb from 'harfbuzzjs';
import { FontFile, FontVariation } from '../../godot/text/shaper.js';

export const FONT_FILES = Object.freeze({
  cinzel: 'Cinzel-Variable.ttf',
  cormorant: 'CormorantGaramond-Variable.ttf',
  cormorantItalic: 'CormorantGaramond-Italic-Variable.ttf',
});

/** @type {Record<'display'|'caps'|'body'|'bold'|'italic'|'numbers', FontVariation>} */
export const Fonts = {};

let loading = null;

/** Browser default: files served from `fonts/` next to index.html (Vite `public/`). */
async function fetchFontBytes(name) {
  const response = await fetch(new URL(`fonts/${name}`, document.baseURI));
  if (!response.ok) throw new Error(`font ${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Loads the three files once and builds the six variations. Idempotent. */
export function loadFonts(fetchBytes = fetchFontBytes) {
  loading ??= (async () => {
    const entries = await Promise.all(Object.entries(FONT_FILES).map(async ([key, file]) => [key, new FontFile(hb, file, await fetchBytes(file))]));
    const files = Object.fromEntries(entries);
    Object.assign(Fonts, {
      display: new FontVariation(files.cinzel, { name: 'display', variation: { wght: 600 }, spacingGlyph: 1 }),
      caps: new FontVariation(files.cinzel, { name: 'caps', variation: { wght: 560 }, spacingGlyph: 3 }),
      body: new FontVariation(files.cormorant, { name: 'body', variation: { wght: 520 } }),
      bold: new FontVariation(files.cormorant, { name: 'bold', variation: { wght: 700 } }),
      italic: new FontVariation(files.cormorantItalic, { name: 'italic', variation: { wght: 500 } }),
      numbers: new FontVariation(files.cormorant, { name: 'numbers', variation: { wght: 600 }, features: { lnum: 1, tnum: 1 } }),
    });
    return Fonts;
  })();
  return loading;
}
