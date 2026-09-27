#!/usr/bin/env node
/**
 * Collects the licence notices of the libraries the port ships (three.js, harfbuzzjs + HarfBuzz,
 * FastNoiseLite) into public/credits/port.json. The Credits panel shows them after the original's
 * Godot sections (licence compliance for the JavaScript build).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8').trim();

/** FastNoiseLite ships its MIT notice in the source header. */
function fastNoiseNotice() {
  const source = read('node_modules/fastnoise-lite/FastNoiseLite.js');
  const header = source.slice(0, source.indexOf('*/') + 2);
  return header.replace(/^\/\/ ?|^\s*\*\/?|^\/\*\*?/gm, '').trim();
}

const entries = [
  { name: 'three.js', license: read('node_modules/three/LICENSE') },
  { name: 'harfbuzzjs', license: read('node_modules/harfbuzzjs/LICENSE') },
  { name: 'FastNoiseLite', license: fastNoiseNotice() },
];
const harfbuzzCopying = 'node_modules/harfbuzzjs/COPYING';
entries.push({
  name: 'HarfBuzz',
  license: existsSync(join(ROOT, harfbuzzCopying))
    ? read(harfbuzzCopying)
    : 'HarfBuzz is licensed under the so-called "Old MIT" licence. Copyright © The HarfBuzz authors.\nThe full notice is at https://github.com/harfbuzz/harfbuzz/blob/main/COPYING',
});

const out = join(ROOT, 'public', 'credits', 'port.json');
writeFileSync(out, JSON.stringify({ intro: 'This JavaScript edition also uses the following libraries:', libraries: entries }, null, 1));
card('credits', [[paint.green('✓'), paint.blue(out.replace(ROOT, '.'))], ...entries.map((e) => [paint.dim(e.name), `${e.license.length} chars`])]);
