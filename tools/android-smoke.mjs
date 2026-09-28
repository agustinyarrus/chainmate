#!/usr/bin/env node
/**
 * android-smoke — the debug APK on a real Android system: boots the emulator (unless a device is
 * already there), installs dist-android/Chainmate-<version>-debug.apk, opens it, waits for the game
 * to draw, and checks what a player would see:
 *
 *   installed   `adb install -r` answers Success
 *   alive       the app's process still runs 20 s after the start (no crash, no ANR kill)
 *   no crash    the crash buffer (`logcat -b crash`) has nothing for the package
 *   drawn       a screenshot (screencap) that is not a flat colour — the menu over the 3D arena
 *   back        the system Back on the bare main menu sends the task to the background, as
 *               MainActivity + window.chainmate.backButton() intend (the app stays alive)
 *   mobile      the phone runs the Mobile renderer (asked through the WebView's DevTools, which a
 *               debug build exposes: adb forward to webview_devtools_remote_<pid>)
 *   quit        the menu's Quit path (Main._quit → OS.quit → @capacitor/app exitApp) ends the app
 *
 *   node tools/android-smoke.mjs [--serial <adb serial>] [--avd <name>] [--keep]
 *
 * The emulator is started with the host GPU (-gpu host: software GL chokes on WebGL) and shut down
 * at the end unless --keep. Screenshots land in _ref/android/. Every wait has a ceiling.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint, spinner } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_ref', 'android');
const APP_ID = 'com.agustinyarrus.chainmate';
const SDK = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const ADB = join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const EMULATOR = join(SDK, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
const DEFAULT_AVD = 'Medium_Phone_API_36.0';
/** Ceilings: the boot, the game's first frames, the alive check. */
const BOOT_TIMEOUT_MS = 240_000;
const DRAW_WAIT_MS = 25_000;
const ALIVE_AFTER_MS = 20_000;
const POLL_MS = 2_000;
/** A screenshot with fewer distinct colours than this is a blank or splash screen, not the game. */
const MIN_DISTINCT_COLOURS = 400;

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : null;
};
const KEEP = argv.includes('--keep');
const AVD = valueOf('--avd') ?? DEFAULT_AVD;
let serial = valueOf('--serial');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** No adb call may hang: a vanished device makes adb wait forever ("waiting for device"). */
const ADB_TIMEOUT_MS = 90_000;

/** adb against the chosen device; throws with its output when it fails or overruns. O(1) + the command. */
function adb(args, { binary = false } = {}) {
  const full = serial ? ['-s', serial, ...args] : args;
  const result = spawnSync(ADB, full, { encoding: binary ? 'buffer' : 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: ADB_TIMEOUT_MS });
  if (result.error?.code === 'ETIMEDOUT') throw new Error(`adb ${args.join(' ')}: no answer in ${ADB_TIMEOUT_MS / 1000} s (did the device go away?)`);
  if (result.error) throw new Error(`adb ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`adb ${args.join(' ')} exited with ${result.status}: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

const devices = () => String(adb(['devices'])).split('\n').slice(1).map((line) => line.trim()).filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);

/** The emulator, started detached with the host GPU; resolves with its adb serial once booted. */
async function bootEmulator(spin) {
  spin.tick(`booting ${AVD}`);
  const child = spawn(EMULATOR, ['-avd', AVD, '-gpu', 'host', '-no-boot-anim', '-no-audio'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const found = devices().find((id) => id.startsWith('emulator-'));
    if (!found) continue;
    serial = found;
    const booted = spawnSync(ADB, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8', windowsHide: true, timeout: ADB_TIMEOUT_MS }).stdout?.trim();
    if (booted === '1') return { serial, started: true };
    spin.tick(`booting ${AVD} (${serial})`);
  }
  throw new Error(`${AVD} did not boot within ${BOOT_TIMEOUT_MS / 1000} s`);
}

/** The local port the WebView's DevTools socket is forwarded to. */
const DEVTOOLS_PORT = 9333;
const EVALUATE_TIMEOUT_MS = 10_000;

/** Forwards the game's WebView DevTools socket (debug builds expose it) to DEVTOOLS_PORT. */
function forwardDevTools(pid) {
  const name = `webview_devtools_remote_${pid}`;
  if (!String(adb(['shell', 'cat', '/proc/net/unix'])).includes(name)) throw new Error(`no ${name}: WebView debugging is off (a release build?)`);
  adb(['forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:${name}`]);
}

/** Runtime.evaluate in the game's page through the forwarded DevTools; the value, by value. */
async function evaluate(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) throw new Error('the WebView has no page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('DevTools socket refused')), { once: true });
  });
  try {
    const reply = new Promise((resolve) => socket.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id === 1) resolve(data);
    }));
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    const answer = await Promise.race([reply, sleep(EVALUATE_TIMEOUT_MS).then(() => null)]);
    if (!answer) throw new Error(`no answer to ${expression} in ${EVALUATE_TIMEOUT_MS / 1000} s`);
    if (answer.result?.exceptionDetails) throw new Error(answer.result.exceptionDetails.text);
    return answer.result?.result?.value;
  } finally {
    socket.close();
  }
}

/**
 * The game's activity records (dumpsys): Back leaves one behind (stopped, in the background),
 * Quit's finish() removes it — Android may keep the emptied process cached either way.
 */
const activityRecords = () => String(adb(['shell', 'dumpsys', 'activity', 'activities'])).split('\n').filter((line) => /ActivityRecord\{/.test(line) && line.includes(`${APP_ID}/.MainActivity`)).length;

/** The process id of the game, or null. */
function gamePid() {
  const result = spawnSync(ADB, ['-s', serial, 'shell', 'pidof', APP_ID], { encoding: 'utf8', windowsHide: true, timeout: ADB_TIMEOUT_MS });
  const pid = result.stdout?.trim();
  return pid ? pid : null;
}

/** A PNG of the screen, and how many distinct colours a coarse sample of it holds. */
function screenshot(name) {
  const png = adb(['exec-out', 'screencap', '-p'], { binary: true });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, png);
  return { file, bytes: png.length };
}

async function distinctColours(file) {
  const { createRequire } = await import('node:module');
  const require = createRequire(join(ROOT, 'mobile', 'package.json'));
  const sharp = require('sharp');
  const { data, info } = await sharp(file).resize(160, 90, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set();
  for (let i = 0; i < data.length; i += info.channels) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  return colours.size;
}

async function main() {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const apk = join(ROOT, 'dist-android', `Chainmate-${version}-debug.apk`);
  if (!existsSync(apk)) throw new Error(`no ${apk}: build it with node tools/apk.mjs`);
  mkdirSync(OUT, { recursive: true });
  const checks = [];
  const check = (ok, label, detail = '') => checks.push({ ok, label, detail });
  const spin = spinner('android smoke');

  let started = false;
  if (!serial) {
    const present = devices();
    if (present.length) serial = present[0];
    else ({ started } = await bootEmulator(spin));
  }
  spin.tick(`installing on ${serial}`);
  const installed = String(adb(['install', '-r', apk]));
  check(/Success/.test(installed), 'installed', serial);

  spin.tick('opening');
  adb(['logcat', '-b', 'crash', '-c']);
  adb(['shell', 'am', 'force-stop', APP_ID]);
  const start = String(adb(['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]));
  const launchMs = (/TotalTime:\s*(\d+)/.exec(start) ?? [, '?'])[1];
  await sleep(DRAW_WAIT_MS);
  spin.tick('screenshot');
  const menu = screenshot('menu');
  const colours = await distinctColours(menu.file);
  check(colours >= MIN_DISTINCT_COLOURS, 'the game draws (menu over the 3D arena)', `${colours} distinct colours in a 160×90 sample · ${menu.file.replace(ROOT, '.')}`);
  const aliveWait = Math.max(0, ALIVE_AFTER_MS - DRAW_WAIT_MS);
  if (aliveWait) await sleep(aliveWait);
  const pid = gamePid();
  check(pid !== null, 'the process is alive after the start', pid ? `pid ${pid} · launch ${launchMs} ms` : 'gone');
  const crashes = String(adb(['logcat', '-b', 'crash', '-d'])).split('\n').filter((line) => line.includes(APP_ID));
  check(crashes.length === 0, 'no crash in logcat', crashes[0]?.slice(0, 120) ?? '');

  spin.tick('back button');
  adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  await sleep(2500);
  const focus = String(adb(['shell', 'dumpsys', 'window', 'displays'])).split('\n').find((line) => /mCurrentFocus|mFocusedApp/.test(line)) ?? '';
  const stillAlive = gamePid() !== null && activityRecords() > 0;
  check(stillAlive && !focus.includes(APP_ID), 'Back on the main menu sends the game to the background', stillAlive ? 'activity kept, another window has the focus' : 'the activity is gone');
  screenshot('after_back');

  spin.tick('renderer and Quit');
  adb(['shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]);
  await sleep(3000);
  const livePid = gamePid();
  if (livePid) {
    forwardDevTools(livePid);
    try {
      const method = await evaluate('window.chainmate && window.chainmate.renderingMethod');
      check(method === 'mobile', 'the phone runs the Mobile renderer', `renderer ${method}`);
      // Scheduled, so the answer leaves before the app does.
      await evaluate("setTimeout(() => window.chainmate.main._quit(), 300), 'scheduled'");
      await sleep(4000);
      const records = activityRecords();
      check(records === 0, 'Quit ends the app (@capacitor/app exitApp → finish)', records === 0 ? 'no activity left' : `${records} activity record(s) left`);
    } finally {
      spawnSync(ADB, ['-s', serial, 'forward', '--remove', `tcp:${DEVTOOLS_PORT}`], { windowsHide: true, timeout: ADB_TIMEOUT_MS });
    }
  } else {
    check(false, 'the app comes back to the front', 'no process after am start');
  }

  if (started && !KEEP) {
    spin.tick('shutting the emulator down');
    spawnSync(ADB, ['-s', serial, 'emu', 'kill'], { windowsHide: true });
  }
  spin.stop();

  const passed = checks.filter((c) => c.ok).length;
  card('android smoke', [
    [passed === checks.length ? paint.green('✓') : paint.red('✗'), `${passed}/${checks.length} checks`, paint.dim(`${APP_ID} on ${serial}`)],
    ...checks.map((c) => [c.ok ? paint.green('✓') : paint.red('✗'), c.label, paint.dim(c.detail)]),
    [paint.dim('shots'), OUT.replace(ROOT, '.')],
  ]);
  process.exitCode = passed === checks.length ? 0 : 1;
}

main().catch((error) => {
  console.error(paint.red(`\n✗ ${error.stack ?? error.message}`));
  process.exitCode = 1;
});
