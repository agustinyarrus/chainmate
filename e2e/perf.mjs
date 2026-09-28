#!/usr/bin/env node
/**
 * perf — where the frame time goes: the game runs in the visible test Chrome with the GPU profiler
 * attached (src/dev/gpu_profiler.js), in every arena, and every costly effect is switched off in
 * turn to see what it costs.
 *
 *   node e2e/perf.mjs                               1600×900, every arena, every effect
 *   node e2e/perf.mjs --sizes 1600x900,1280x720     other window sizes
 *   node e2e/perf.mjs --variants crypt --seconds 4  one arena, shorter windows
 *   node e2e/perf.mjs --no-ablate                   the full frame only
 *
 * Output: a card in the terminal and _ref/port/perf/report.html + summary.json (local files).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../tools/cdp.mjs';
import { card, paint, spinner } from '../tools/term.mjs';
import { ROOT, BASE, openGame, exitWhenFlushed, webglProblems } from './lib.mjs';

const OUT = join(ROOT, '_ref', 'port', 'perf');
const VARIANTS = ['outpost', 'crypt', 'court'];
/** Seconds a new state is left alone before measuring: shaders compile, the sky's layers catch up. */
const SETTLE_SECONDS = 2.5;

/**
 * The effects that cost, and how the page switches each off and back on. `off` / `on` run in the
 * page with `main`, `pipeline` and `environment` in scope.
 */
const ABLATIONS = Object.freeze([
  { name: 'ssao', off: 'environment.ssao_enabled = false', on: 'environment.ssao_enabled = true' },
  { name: 'ssil', off: 'environment.ssil_enabled = false', on: 'environment.ssil_enabled = true' },
  { name: 'volumetric fog', off: 'saved.volfog = environment.volumetric_fog_enabled; environment.volumetric_fog_enabled = false', on: 'environment.volumetric_fog_enabled = saved.volfog' },
  { name: 'subsurface', off: 'pipeline.subsurface.active = false', on: 'pipeline.subsurface.active = true' },
  { name: 'shadows', off: 'main.arena.key_light.shadow_enabled = false', on: 'main.arena.key_light.shadow_enabled = true' },
  { name: 'glow', off: 'environment.glow_enabled = false', on: 'environment.glow_enabled = true' },
  { name: 'msaa', off: 'saved.msaa = pipeline.msaa; pipeline.setMsaa(0)', on: 'pipeline.setMsaa(saved.msaa)' },
]);

function parseArgs(argv) {
  const options = { sizes: ['1600x900'], variants: VARIANTS, seconds: 5, ablate: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sizes') options.sizes = argv[++i].split(',');
    else if (arg === '--variants') options.variants = argv[++i].split(',');
    else if (arg === '--seconds') options.seconds = Number(argv[++i]);
    else if (arg === '--no-ablate') options.ablate = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  for (const variant of options.variants) if (!VARIANTS.includes(variant)) throw new Error(`unknown arena: ${variant}`);
  options.sizes = options.sizes.map((size) => {
    const [width, height] = size.split('x').map(Number);
    if (!(width > 0 && height > 0)) throw new Error(`bad size: ${size} (use WIDTHxHEIGHT)`);
    return { width, height };
  });
  return options;
}

/** Runs `code` in the page with the game's handles in scope. */
const inGame = (page, code) =>
  page.eval(`(() => { const app = window.chainmate; const main = app.main; const pipeline = app.pipeline; const environment = main.arena.environment; const saved = (window.__perfSaved ??= {}); ${code}; })()`);

/** Measures the current state: settles, forgets old samples, waits, reads the profiler. */
async function measure(page, seconds) {
  await sleep(SETTLE_SECONDS * 1000);
  await page.eval('window.__profiler.reset(); window.chainmate.stats.frames = 0; window.chainmate.stats.since = performance.now();');
  await sleep(seconds * 1000);
  const report = JSON.parse(await page.eval('JSON.stringify(window.__profiler.report())'));
  report.fps = await page.eval('window.chainmate.stats.fps');
  report.subsurface = await page.eval('window.chainmate.pipeline.stats.subsurface');
  return report;
}

const ms = (value) => value.toFixed(2).padStart(6);

function sectionRows(report) {
  return report.sections.map((s) => [paint.dim(s.name.padEnd(16)), `gpu ${ms(s.gpu.mean)} ms  p95 ${ms(s.gpu.p95)}`, paint.dim(`cpu ${ms(s.cpu.mean)}`), paint.teal(`${(100 * s.share).toFixed(0).padStart(3)} %`)]);
}

function html(runs) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const blocks = runs.map((run) => {
    const full = run.full;
    const bars = full.sections
      .map((s) => `<tr><td>${esc(s.name)}</td><td>${s.gpu.mean.toFixed(2)}</td><td>${s.gpu.p95.toFixed(2)}</td><td>${s.cpu.mean.toFixed(2)}</td><td><div class="bar" style="width:${Math.max(1, 360 * s.share).toFixed(0)}px"></div></td></tr>`)
      .join('');
    const ablations = run.ablations
      .map((a) => `<tr><td>without ${esc(a.name)}</td><td>${a.report.gpuMs.mean.toFixed(2)}</td><td style="color:#9ece6a">−${(full.gpuMs.mean - a.report.gpuMs.mean).toFixed(2)}</td><td>${a.report.fps}</td></tr>`)
      .join('');
    return `<section><h2>${esc(run.variant)} · ${run.size.width}×${run.size.height}</h2>
      <p class="sub">GPU ${full.gpuMs.mean.toFixed(2)} ms (p95 ${full.gpuMs.p95.toFixed(2)}) · CPU ${full.cpuMs.mean.toFixed(2)} ms · ${full.fps} fps · ${full.frames} frames${full.subsurface ? ' · subsurface on' : ''}</p>
      <table><tr><th>pass</th><th>gpu ms</th><th>p95</th><th>cpu ms</th><th>share</th></tr>${bars}</table>
      ${ablations ? `<table><tr><th>state</th><th>gpu ms</th><th>saved</th><th>fps</th></tr>${ablations}</table>` : ''}</section>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chainmate · frame cost</title><style>
  body{margin:0;background:#000;color:#c0caf5;font:200 14px/1.5 'Cascadia Code','Cascadia Mono',Consolas,monospace;padding:28px 36px}
  h1{font-weight:200;color:#bb9af7;letter-spacing:.06em;margin:0 0 4px} h2{font-weight:200;color:#7aa2f7;margin:0 0 4px;font-size:16px}
  p.sub{color:#565f89;margin:0 0 14px} section{border:1px solid #1f2335;border-radius:12px;margin:0 0 22px;padding:14px 18px;background:#05060a}
  table{border-collapse:collapse;margin:0 0 14px} td,th{padding:3px 16px 3px 0;text-align:right;font-weight:200} th{color:#565f89} td:first-child,th:first-child{text-align:left;color:#7aa2f7}
  .bar{height:9px;border-radius:5px;background:linear-gradient(90deg,#7aa2f7,#bb9af7)}
  </style></head><body><h1>Chainmate · frame cost</h1><p class="sub">GPU timer queries per pass · generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}</p>${blocks.join('')}</body></html>`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(OUT, { recursive: true });
  const runs = [];
  for (const size of options.sizes) {
    const url = new URL('index.html', BASE);
    url.searchParams.set('stats', '');
    const { page, hud } = await openGame(url.href.replace(/=(?=&|$)/g, ''), { ...size, title: 'Chainmate · costo del cuadro' });
    const attached = await page.eval(`(async () => { const { GpuProfiler } = await import('/src/dev/gpu_profiler.js'); window.__profiler = GpuProfiler.attach(window.chainmate.pipeline); return window.__profiler !== null; })()`);
    if (!attached) throw new Error('this browser offers no GPU timers (EXT_disjoint_timer_query_webgl2)');
    for (const variant of options.variants) {
      const spin = spinner(`${variant} ${size.width}×${size.height}`);
      await hud?.paso(`${variant} · cuadro completo`);
      await inGame(page, `main._set_variant(${JSON.stringify(variant)})`);
      const full = await measure(page, options.seconds);
      const ablations = [];
      if (options.ablate) {
        for (const ablation of ABLATIONS) {
          spin.tick(`without ${ablation.name}`);
          await hud?.paso(`${variant} · sin ${ablation.name}`);
          await inGame(page, ablation.off);
          ablations.push({ name: ablation.name, report: await measure(page, options.seconds) });
          await inGame(page, ablation.on);
        }
      }
      spin.stop();
      runs.push({ size, variant, full, ablations });
      card(`${variant} · ${size.width}×${size.height}`, [
        [paint.mauve('frame'), `gpu ${ms(full.gpuMs.mean)} ms  p95 ${ms(full.gpuMs.p95)}`, paint.dim(`cpu ${ms(full.cpuMs.mean)}`), paint.green(`${full.fps} fps`), full.subsurface ? paint.amber('sss') : ''],
        ...sectionRows(full),
        ...ablations.map((a) => [paint.dim(`without ${a.name}`.padEnd(24)), `gpu ${ms(a.report.gpuMs.mean)} ms`, paint.green(`−${ms(full.gpuMs.mean - a.report.gpuMs.mean)}`), paint.dim(`${a.report.fps} fps`)]),
      ]);
    }
    const errors = JSON.parse(await page.eval('JSON.stringify(window.chainmate.errors)'));
    if (errors.length) console.log(paint.red(`errors in the page: ${JSON.stringify(errors.slice(0, 5))}`));
    // A refused draw costs nothing and shows nothing: the numbers would flatter a broken frame.
    const gl = webglProblems(page);
    if (gl.errors.length) {
      console.log(paint.red(`WebGL refused draws (the numbers above are not a full frame):\n  ${gl.errors.slice(0, 4).join('\n  ')}`));
      process.exitCode = 1;
    }
    if (gl.warnings.length) console.log(paint.amber(`shader compiler remarks:\n  ${gl.warnings.slice(0, 4).join('\n  ')}`));
    await hud?.fin({ subtitulo: `${runs.length} mediciones` });
    page.close();
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ generated: new Date().toISOString(), options, runs }, null, 1));
  const file = join(OUT, 'report.html');
  writeFileSync(file, html(runs));
  console.log(paint.dim(`\n  report ${file}`));
}

main()
  .catch((error) => {
    console.error(paint.red(`\n✗ ${error.stack ?? error.message}`));
    process.exitCode = 1;
  })
  .finally(() => exitWhenFlushed());
