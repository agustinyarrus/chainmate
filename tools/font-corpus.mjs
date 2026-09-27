#!/usr/bin/env node
/**
 * Builds the text corpus the font oracle measures: every string literal of the original scripts (UI
 * copy, relic/event/encounter texts, banners), a few formatted samples, and the character set they use.
 *
 *   node tools/font-corpus.mjs   →   _oracle/font_corpus.json   (read by _oracle/probe_fonts.gd)
 *
 * O(total source size): one regex pass per file, de-duplicated with a Set.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, '_original', 'scripts');
const OUT = join(ROOT, '_oracle', 'font_corpus.json');

/** Double-quoted GDScript literals (escapes kept simple: \" \n \t \\). */
const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"/g;
const MIN_LENGTH = 2;
const MAX_LENGTH = 400;
/** Identifiers, paths, node names and format-only strings are not display text. */
const NOT_TEXT = /^(res|user):\/\/|^[a-z0-9_]+$|^[A-Z_]+$|^%[a-z]$|^\W+$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.endsWith('.gd')) yield path;
  }
}

const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

const strings = new Set();
let files = 0;
for (const path of walk(SCRIPTS)) {
  files += 1;
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(STRING_LITERAL)) {
    const text = unescape(match[1]);
    if (text.length < MIN_LENGTH || text.length > MAX_LENGTH || NOT_TEXT.test(text)) continue;
    // Multi-line copy is measured line by line (labels shape each line on its own).
    for (const line of text.split('\n')) if (line.trim().length >= MIN_LENGTH) strings.add(line);
  }
}

// Formatted samples the UI produces at runtime.
for (let n = 0; n <= 12; n++) strings.add(`Encounter ${n} / 9`);
for (const n of [0, 1, 2, 5, 10, 12, 25, 40, 99, 120, 250]) {
  strings.add(`+${n} XP`);
  strings.add(`+${n} gold`);
  strings.add(String(n));
  strings.add(`${n} / 9`);
}
for (const t of ['Turn 1', 'Turn 5', 'Turn 12', 'Hint (2)', 'Hint (0)', 'ENEMY TURN', 'YOUR TURN', 'Act I', 'Act II', 'Act III']) strings.add(t);

const corpus = [...strings].sort();
const charset = [...new Set(corpus.join('') + ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~')]
  .filter((c) => c !== '\n' && c !== '\t')
  .sort();

writeFileSync(OUT, JSON.stringify({ strings: corpus, charset: charset.join('') }, null, 1));
card('font corpus', [
  [paint.green('✓'), paint.blue(OUT)],
  [paint.dim('scripts'), String(files)],
  [paint.dim('strings'), String(corpus.length)],
  [paint.dim('charset'), `${charset.length} characters`],
]);
