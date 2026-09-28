#!/usr/bin/env node
/**
 * audio — the sound of the port in a real browser (VISIBLE Chrome, narrated in the on-page HUD;
 * started with --mute-audio, so the graph is measured but nobody at the desk hears it):
 *
 *   1  before any gesture the engine stays locked and the page is silent, while the effects are
 *      synthesised in workers (Sfx.is_ready)
 *   2  a real click on the canvas (a user activation) starts the context and the mixer
 *   3  the menu's music fades in over 2.5 s (the original's MUSIC_FADE_IN_SECONDS)
 *   4  an effect is heard over it at once
 *   5  the Master bus at 0 silences everything; back at 1, the sound returns
 *
 * What is heard is measured, not assumed: a probe injected before the page's own scripts taps every
 * connection to the context's destination with an AnalyserNode and reports RMS levels.
 *
 *   node e2e/audio.mjs          (the dev server must be running: npm run dev)
 *
 * Output: a card in the terminal and _ref/port/audio/summary.json (the envelope, sample by sample).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from '../tools/cdp.mjs';
import { card, paint } from '../tools/term.mjs';
import { ROOT, BASE, openGame, exitWhenFlushed } from './lib.mjs';

const OUT = join(ROOT, '_ref', 'port', 'audio');
/** Its own Chrome (muted, real autoplay policy), apart from the tours' on 9340. */
const AUDIO_DEBUG_PORT = 9342;
/** An RMS under this is silence (−70 dBFS). */
const SILENCE = 10 ** (-70 / 20);
/** The music, once in, is louder than this (−40 dBFS). */
const AUDIBLE = 10 ** (-40 / 20);
const READY_TIMEOUT_MS = 30000;
const RUNNING_TIMEOUT_MS = 8000;
const FADE_SAMPLE_MS = 100;
const FADE_WINDOW_MS = 3200;
/** Where the click lands: the empty sky right of the menu, which no control covers. */
const CLICK_AT = Object.freeze({ x: 1450, y: 120 });

/**
 * Runs in the page before its own scripts: every AudioNode that connects to a destination also feeds
 * an AnalyserNode of its context; window.__audioProbe.level() is the RMS of what reaches the speakers.
 */
const PROBE = `(() => {
  const analysers = new Map();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode) {
      let analyser = analysers.get(this.context);
      if (!analyser) {
        analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        analysers.set(this.context, analyser);
      }
      connect.call(this, analyser);
    }
    return result;
  };
  const buffer = new Float32Array(2048);
  window.__audioProbe = {
    contexts: () => analysers.size,
    level() {
      let peak = 0;
      for (const analyser of analysers.values()) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        peak = Math.max(peak, Math.sqrt(sum / buffer.length));
      }
      return peak;
    },
  };
})();`;

const dbfs = (rms) => (rms > 0 ? `${(20 * Math.log10(rms)).toFixed(1)} dBFS` : '−∞ dBFS');

async function main() {
  mkdirSync(OUT, { recursive: true });
  const url = new URL('index.html', BASE);
  url.searchParams.set('ephemeral', '');
  // The probe must exist before the game builds its audio graph: register it, then open the game.
  // A Chrome of its own: muted (measured, never heard on the desktop) and with the real autoplay
  // policy, so the first gesture is what unlocks the sound — as for a player.
  const { page, hud, chrome } = await openGame(url.href.replace(/=(?=&|$)/g, ''), {
    title: 'Chainmate · audio en el navegador',
    beforeLoad: PROBE,
    chrome: { port: AUDIO_DEBUG_PORT, muteAudio: true, autoplay: false },
  });
  const checks = [];
  const check = async (ok, label, detail = '') => {
    checks.push({ ok, label, detail });
    await hud?.check(ok, label, detail);
    console.log(`  ${ok ? paint.green('✓') : paint.red('✗')} ${label} ${paint.dim(detail)}`);
  };
  const snapshot = async () => JSON.parse(await page.eval('JSON.stringify(window.chainmate.audio.snapshot())'));
  const level = () => page.eval('window.__audioProbe.level()');
  const waitFor = async (predicate, timeout) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (predicate(await snapshot())) return true;
      await sleep(100);
    }
    return false;
  };

  hud?.grupo('antes del gesto', 'sin contexto de audio');
  await hud?.paso('El juego arranca: el motor de audio espera un gesto y sintetiza los efectos en workers');
  const locked = await snapshot();
  await check(locked.state === 'locked', 'sin gesto, el motor sigue bloqueado', `state ${locked.state}`);
  const readyStarted = Date.now();
  const ready = await waitFor((s) => s.ready, READY_TIMEOUT_MS);
  const built = await snapshot();
  await check(ready, 'los 24 efectos quedan sintetizados', `${built.effects} efectos · ${built.buildMsec.effects?.toFixed?.(0) ?? '?'} ms en el worker · ${Date.now() - readyStarted} ms de espera`);
  await check((await level()) <= SILENCE, 'la página está en silencio', dbfs(await level()));

  hud?.grupo('el primer gesto', 'clic real en el lienzo');
  await hud?.paso('Un clic de verdad (activación de usuario) sobre el cielo, donde no hay botones');
  await page.click(CLICK_AT.x, CLICK_AT.y);
  const running = await waitFor((s) => s.state === 'running', RUNNING_TIMEOUT_MS);
  const started = await snapshot();
  await check(running, 'el clic arranca el contexto y el mezclador', `${started.backend} · ${started.sampleRate} Hz`);

  hud?.grupo('la música', 'entrada de 2.5 s');
  await hud?.paso('La música del menú entra con su fundido: mido el nivel cada 100 ms');
  await waitFor((s) => s.musicReady, READY_TIMEOUT_MS);
  const envelope = [];
  const fadeStarted = Date.now();
  while (Date.now() - fadeStarted < FADE_WINDOW_MS) {
    envelope.push({ ms: Date.now() - fadeStarted, rms: await level(), gain: (await snapshot()).musicGain });
    await sleep(FADE_SAMPLE_MS);
  }
  const loudest = Math.max(...envelope.map((e) => e.rms));
  const firstThird = envelope.slice(0, Math.floor(envelope.length / 3));
  const lastThird = envelope.slice(-Math.floor(envelope.length / 3));
  const mean = (rows) => rows.reduce((sum, e) => sum + e.rms, 0) / Math.max(1, rows.length);
  await check(loudest > AUDIBLE, 'la música suena', `pico ${dbfs(loudest)}`);
  await check(mean(lastThird) >= mean(firstThird), 'y sube con el fundido (no entra de golpe)', `${dbfs(mean(firstThird))} → ${dbfs(mean(lastThird))}`);

  hud?.grupo('un efecto', 'ui_click sobre la música');
  await hud?.paso('Sfx.play("ui_click") y mido el pico en los 200 ms siguientes');
  const before = await level();
  await page.eval(`window.chainmate.audio.play('ui_click', 1.0, 0.0)`);
  let spike = 0;
  for (let i = 0; i < 8; i++) {
    spike = Math.max(spike, await level());
    await sleep(25);
  }
  await check(spike > before, 'el efecto se oye encima de la música', `${dbfs(before)} → ${dbfs(spike)}`);

  hud?.grupo('el bus Master', 'volumen 0 y vuelta a 1');
  await hud?.paso('Master a 0: todo tiene que callarse; a 1, vuelve');
  await page.eval(`window.chainmate.audio.setBusVolume('Master', 0)`);
  await sleep(400);
  const muted = await level();
  await page.eval(`window.chainmate.audio.setBusVolume('Master', 1)`);
  await sleep(400);
  const restored = await level();
  await check(muted <= SILENCE, 'con Master en 0 no sale nada', dbfs(muted));
  await check(restored > AUDIBLE, 'con Master en 1 vuelve el sonido', dbfs(restored));

  const errors = JSON.parse(await page.eval('JSON.stringify(window.chainmate.errors)'));
  await check(errors.length === 0 && page.exceptions.length === 0, 'sin errores en la página', errors.concat(page.exceptions).slice(0, 2).join(' | '));

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ generated: new Date().toISOString(), checks, envelope, engine: await snapshot() }, null, 1));
  const passed = checks.filter((c) => c.ok).length;
  await hud?.fin({ subtitulo: `${passed}/${checks.length} verificaciones`, pie: 'Chrome real · analizador en la salida' });
  card('audio', [
    [passed === checks.length ? paint.green('✓') : paint.red('✗'), `${passed}/${checks.length} checks`, paint.dim(`→ ${join(OUT, 'summary.json')}`)],
    ...checks.map((c) => [c.ok ? paint.green('✓') : paint.red('✗'), c.label, paint.dim(c.detail)]),
  ]);
  page.close();
  await chrome.close();
  process.exitCode = passed === checks.length ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(paint.red(`\n✗ ${error.stack ?? error.message}`));
    process.exitCode = 1;
  })
  .finally(() => exitWhenFlushed());
