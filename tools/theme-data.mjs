#!/usr/bin/env node
/**
 * Converts the theme oracle dump (_oracle/theme.json — the effective theme of each Control type in
 * the original build) into the port's base theme: src/godot/ui/theme_data.json. Icons stay as PNG
 * data URLs. Run after `node tools/oracle.mjs theme`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = JSON.parse(readFileSync(join(ROOT, '_oracle', 'theme.json'), 'utf8')).entries;
const out = { globals: null, types: {} };
let icons = 0;
let boxes = 0;
for (const entry of entries) {
  if (entry.k === 'globals') {
    const { k, ...globals } = entry;
    out.globals = globals;
    continue;
  }
  const type = { constants: entry.constants, colors: entry.colors, font_sizes: entry.font_sizes, fonts: entry.fonts, styleboxes: {}, icons: {} };
  for (const [name, box] of Object.entries(entry.styleboxes)) {
    type.styleboxes[name] = box;
    boxes += 1;
  }
  for (const [name, icon] of Object.entries(entry.icons)) {
    type.icons[name] = icon.png ? { size: icon.size, src: `data:image/png;base64,${icon.png}` } : { size: icon.size ?? [0, 0], src: null };
    icons += 1;
  }
  out.types[entry.type] = type;
}
const file = join(ROOT, 'src', 'godot', 'ui', 'theme_data.json');
writeFileSync(file, JSON.stringify(out, null, 1));
card('theme data', [
  [paint.green('✓'), paint.blue(file.replace(ROOT, '.'))],
  [paint.dim('types'), String(Object.keys(out.types).length)],
  [paint.dim('styleboxes'), String(boxes)],
  [paint.dim('icons'), String(icons)],
]);
