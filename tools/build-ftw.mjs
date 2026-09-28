#!/usr/bin/env node
/**
 * build-ftw — compiles the glyph rasterizer (native/ftw) to WebAssembly.
 *
 *   node tools/build-ftw.mjs            incremental build → src/godot/text/ftw.wasm
 *   node tools/build-ftw.mjs --clean    forget the object cache first
 *
 * Inputs: FreeType 2.14.3 and HarfBuzz 14.2.0 exactly as Godot 4.7.2 vendors them
 * (tools/fetch-godot-src.py → _build/godot-src/thirdparty), built with the engine's options
 * (FT_CONFIG_OPTION_USE_HARFBUZZ: the auto-hinter asks HarfBuzz which glyphs a script covers), plus
 * the shim in native/ftw. Compiler: Zig's clang (`ZIG` env var, or Box/_tools/zig).
 *
 * Objects are cached by the hash of (source, flags, headers' newest mtime); translation units build
 * in parallel, one per core. setjmp/longjmp (the smooth rasterizer's pool overflow) uses WebAssembly
 * exception handling with the runtime in native/ftw/ftw_sjlj.c. The module's only imports are six
 * WASI calls its C library references (environ_get, environ_sizes_get, fd_close, fd_seek, fd_write,
 * proc_exit); src/godot/text/ftw.js answers them without a filesystem.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint, spinner } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THIRDPARTY = join(ROOT, '_build', 'godot-src', 'thirdparty');
const FREETYPE = join(THIRDPARTY, 'freetype');
const HARFBUZZ = join(THIRDPARTY, 'harfbuzz', 'src');
const SHIM = join(ROOT, 'native', 'ftw');
const OBJECTS = join(ROOT, '_build', 'ftw', 'obj');
const CACHE = join(ROOT, '_build', 'zig-cache');
const OUTPUT = join(ROOT, 'src', 'godot', 'text', 'ftw.wasm');
const ZIG = process.env.ZIG ?? join(process.env.USERPROFILE ?? '', 'Box', '_tools', 'zig', 'zig-x86_64-windows-0.15.2', 'zig.exe');
const STACK_BYTES = 1 << 20; // the smooth rasterizer keeps its 16 KiB cell pool on the stack

const TARGET = ['-target', 'wasm32-wasi', '-O2', '-mexception-handling', '-fvisibility=hidden', '-ffunction-sections', '-fdata-sections', '-DNDEBUG'];
const C_FLAGS = [
  ...TARGET, '-std=c11', '-mllvm', '-wasm-enable-sjlj',
  '-DFT2_BUILD_LIBRARY', '-DFT_CONFIG_OPTION_USE_HARFBUZZ', '-DFT_CONFIG_MODULES_H=<ftw_modules.h>',
  `-I${SHIM}`, `-I${join(FREETYPE, 'include')}`, '-w',
];
const CXX_FLAGS = [
  ...TARGET, '-std=c++17', '-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics',
  '-DHB_NO_MT', '-DHB_NO_GETENV', '-DHB_NO_SETLOCALE', '-DHB_NO_OPEN', '-DHB_NO_MMAP', '-DHB_NO_ATEXIT',
  `-I${HARFBUZZ}`, '-w',
];

const FREETYPE_UNITS = [
  'src/autofit/autofit.c', 'src/base/ftbase.c', 'src/base/ftbbox.c', 'src/base/ftbitmap.c', 'src/base/ftdebug.c',
  'src/base/ftglyph.c', 'src/base/ftinit.c', 'src/base/ftmm.c', 'src/base/ftstroke.c', 'src/psnames/psnames.c',
  'src/sfnt/sfnt.c', 'src/smooth/smooth.c', 'src/truetype/truetype.c',
];
const HARFBUZZ_UNITS = [
  'hb-aat-layout.cc', 'hb-aat-map.cc', 'hb-blob.cc', 'hb-buffer-serialize.cc', 'hb-buffer-verify.cc', 'hb-buffer.cc',
  'hb-common.cc', 'hb-draw.cc', 'hb-face-builder.cc', 'hb-face.cc', 'hb-fallback-shape.cc', 'hb-font.cc', 'hb-map.cc',
  'hb-number.cc', 'hb-ot-cff1-table.cc', 'hb-ot-cff2-table.cc', 'hb-ot-color.cc', 'hb-ot-face.cc', 'hb-ot-font.cc',
  'hb-ot-layout.cc', 'hb-ot-map.cc', 'hb-ot-math.cc', 'hb-ot-meta.cc', 'hb-ot-metrics.cc', 'hb-ot-name.cc',
  'hb-ot-shaper-arabic.cc', 'hb-ot-shaper-default.cc', 'hb-ot-shaper-hangul.cc', 'hb-ot-shaper-hebrew.cc',
  'hb-ot-shaper-indic-table.cc', 'hb-ot-shaper-indic.cc', 'hb-ot-shaper-khmer.cc', 'hb-ot-shaper-myanmar.cc',
  'hb-ot-shaper-syllabic.cc', 'hb-ot-shaper-thai.cc', 'hb-ot-shaper-use.cc', 'hb-ot-shaper-vowel-constraints.cc',
  'hb-ot-shape-fallback.cc', 'hb-ot-shape-normalize.cc', 'hb-ot-shape.cc', 'hb-ot-tag.cc', 'hb-ot-var.cc',
  'hb-outline.cc', 'hb-paint-bounded.cc', 'hb-paint-extents.cc', 'hb-paint.cc', 'hb-set.cc', 'hb-shape-plan.cc',
  'hb-shape.cc', 'hb-shaper.cc', 'hb-static.cc', 'hb-style.cc', 'hb-ucd.cc', 'hb-unicode.cc', 'OT/Var/VARC/VARC.cc',
];
const SHIM_UNITS = ['ftw.c', 'ftw_system.c', 'ftw_sjlj.c'];

/** Runs a process; resolves with { code, output }. stdout and stderr are drained together. */
function run(file, args, env) {
  return new Promise((done) => {
    const child = spawn(file, args, { env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => done({ code: -1, output: String(error) }));
    child.on('close', (code) => done({ code, output }));
  });
}

/** Newest modification time under a folder — O(files), once per build. Headers invalidate objects. */
function newestMtime(folder) {
  let newest = 0;
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    newest = Math.max(newest, statSync(join(entry.parentPath ?? entry.path, entry.name)).mtimeMs);
  }
  return newest;
}

/** Work queue with a fixed number of lanes; keeps results in input order. */
async function pool(items, lanes, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  }));
  return results;
}

function units() {
  const list = [];
  for (const unit of FREETYPE_UNITS) list.push({ source: join(FREETYPE, unit), flags: C_FLAGS, family: 'freetype' });
  for (const unit of HARFBUZZ_UNITS) list.push({ source: join(HARFBUZZ, unit), flags: CXX_FLAGS, family: 'harfbuzz' });
  for (const unit of SHIM_UNITS) list.push({ source: join(SHIM, unit), flags: C_FLAGS, family: 'shim' });
  return list;
}

async function main() {
  const started = Date.now();
  if (!existsSync(ZIG)) throw new Error(`Zig not found at ${ZIG} (set the ZIG environment variable)`);
  if (!existsSync(join(FREETYPE, 'include')) || !existsSync(HARFBUZZ)) {
    throw new Error('sources missing — run: python tools/fetch-godot-src.py thirdparty/freetype thirdparty/harfbuzz (inside _build/godot-src)');
  }
  if (process.argv.includes('--clean')) rmSync(OBJECTS, { recursive: true, force: true });
  mkdirSync(OBJECTS, { recursive: true });
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: CACHE, ZIG_LOCAL_CACHE_DIR: CACHE };
  const headerStamp = { freetype: newestMtime(FREETYPE), harfbuzz: newestMtime(HARFBUZZ), shim: Math.max(newestMtime(SHIM), newestMtime(FREETYPE)) };

  const all = units();
  const spin = spinner(`compiling ${all.length} units`);
  let finished = 0;
  let reused = 0;
  const failures = [];
  const objects = await pool(all, availableParallelism(), async (unit) => {
    const key = createHash('sha256').update(readFileSync(unit.source)).update(unit.flags.join('\0')).update(String(headerStamp[unit.family])).digest('hex').slice(0, 20);
    const object = join(OBJECTS, `${basename(unit.source).replace(/\W+/g, '_')}-${key}.o`);
    if (existsSync(object)) reused += 1;
    else {
      const compiler = unit.source.endsWith('.cc') ? 'c++' : 'cc';
      const result = await run(ZIG, [compiler, ...unit.flags, '-c', unit.source, '-o', object], env);
      if (result.code !== 0) failures.push({ unit: unit.source, output: result.output });
    }
    spin.tick(`${++finished}/${all.length}  ${basename(unit.source)}`);
    return object;
  });
  spin.stop();
  if (failures.length) {
    for (const failure of failures.slice(0, 3)) console.error(paint.red(`\n✗ ${failure.unit}\n`) + failure.output.split('\n').slice(0, 30).join('\n'));
    throw new Error(`${failures.length} unit(s) failed to compile`);
  }

  const link = await run(ZIG, [
    'c++', '-target', 'wasm32-wasi', '-O2', '-mexec-model=reactor', '-mexception-handling', '-fno-exceptions', ...objects, '-o', OUTPUT,
    '-Wl,--gc-sections', '-Wl,--strip-debug', `-Wl,-z,stack-size=${STACK_BYTES}`,
  ], env);
  if (link.code !== 0) {
    console.error(link.output.split('\n').slice(0, 60).join('\n'));
    throw new Error('link failed');
  }

  const bytes = readFileSync(OUTPUT);
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((entry) => `${entry.module}.${entry.name}`);
  const exported = WebAssembly.Module.exports(module).filter((entry) => entry.kind === 'function').map((entry) => entry.name);
  writeFileSync(`${OUTPUT}.json`, `${JSON.stringify({ freetype: '2.14.3', harfbuzz: '14.2.0', engine: 'Godot 4.7.2', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), exports: exported, imports }, null, 2)}\n`);
  card('build-ftw', [
    [paint.green('✓'), paint.blue('ftw.wasm'), `${(bytes.length / 1024).toFixed(0)} KiB`],
    [paint.dim('units'), `${all.length} (${reused} from cache)`],
    [paint.dim('exports'), exported.filter((name) => name.startsWith('ftw_')).length + ' ftw functions'],
    [paint.dim('imports'), imports.length ? paint.amber(imports.join(', ')) : paint.green('none')],
    [paint.dim('time'), `${((Date.now() - started) / 1000).toFixed(1)} s`],
  ]);
}

main().catch((error) => {
  console.error(paint.red(`\n✗ ${error.message}`));
  process.exitCode = 1;
});
