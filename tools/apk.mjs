#!/usr/bin/env node
/**
 * apk — Chainmate for Android, end to end, with plain Node:
 *
 *   node tools/apk.mjs [--release | --aab] [--install] [--run] [--serial <adb serial>] [--gradle-only]
 *
 *   1  the environment: a JDK 17+ and the Android SDK; writes mobile/android/local.properties if it
 *      is missing, with forward slashes (Java's .properties parser eats backslashes, and Gradle then
 *      looks for the SDK in "C:Users<you>AppData…")
 *   2  the web build for Android: CHAINMATE_TARGET=android → dist-android/www, the game page alone
 *   3  `cap sync android`: that copy into the native project (installs mobile/node_modules if missing)
 *   4  Gradle: assembleDebug (debug key, installable); --release assembleRelease; --aab bundleRelease
 *      (what Google Play takes). Release builds are signed with mobile/android/keystore.properties
 *      when it exists, otherwise left unsigned
 *   5  the package, named: dist-android/Chainmate-<version>[-debug|-unsigned].{apk,aab}, with its
 *      SHA-256 and, when signed, the certificate's fingerprint (the one Play registers); --install
 *      puts it on the connected phone or emulator (adb install -r), --run also opens it
 *
 * Every step fails loudly with the command that failed. Requirements: JDK 17+, the Android SDK
 * (ANDROID_HOME / ANDROID_SDK_ROOT / Android Studio's default location).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint, spinner } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'mobile');
const ANDROID = join(MOBILE, 'android');
const DIST = join(ROOT, 'dist-android');
const APP_ID = 'com.agustinyarrus.chainmate';
const WINDOWS = process.platform === 'win32';
const MIN_JDK = 17;
const MB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// ─────────────────────────────────────────────────────────────── arguments ─────────────────────────

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : null;
};
const KNOWN = new Set(['--release', '--aab', '--install', '--run', '--serial', '--gradle-only']);
for (const arg of argv) if (arg.startsWith('--') && !KNOWN.has(arg)) throw new Error(`unknown argument: ${arg}`);
const AAB = has('--aab');
const RELEASE = has('--release') || AAB;
const RUN = has('--run');
const INSTALL = has('--install') || RUN;
const GRADLE_ONLY = has('--gradle-only');
const SERIAL = valueOf('--serial');

// ─────────────────────────────────────────────────────────────── running things ────────────────────

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
const log = (step, text) => console.log(`${paint.dim(elapsed().padStart(8))}  ${paint.blue(step)}  ${text}`);

/** Runs a program; a failure stops the tool with the command and its output. O(1) + the program. */
function run(command, args, { cwd = ROOT, env = process.env, quiet = true } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: quiet ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${basename(command)}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = quiet ? `\n${(result.stderr || result.stdout || '').trim().split('\n').slice(-30).join('\n')}` : '';
    throw new Error(`${basename(command)} ${args.join(' ')} exited with ${result.status}${output}`);
  }
  return result;
}

/** A .bat/.cmd needs cmd.exe on Windows (Node does not run them directly). */
const runScript = (script, args, options) => (WINDOWS ? run('cmd.exe', ['/d', '/c', script, ...args], options) : run(script, args, options));

// ─────────────────────────────────────────────────────────────── the environment ───────────────────

/** The major version of the java Gradle will use (JAVA_HOME first, then the PATH); 0 if none. */
function jdkMajor() {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', WINDOWS ? 'java.exe' : 'java') : 'java';
  const result = spawnSync(java, ['-version'], { encoding: 'utf8', windowsHide: true });
  const match = /version "(\d+)(?:\.(\d+))?/.exec(`${result.stderr ?? ''}${result.stdout ?? ''}`);
  if (result.error || !match) return { java, major: 0 };
  // "1.8.0" is Java 8; "17.0.17" is 17.
  return { java, major: match[1] === '1' ? Number(match[2]) : Number(match[1]) };
}

/** The Android SDK: the environment, or where Android Studio puts it. */
function sdkDir() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    WINDOWS && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    process.platform === 'darwin' ? join(homedir(), 'Library', 'Android', 'sdk') : join(homedir(), 'Android', 'Sdk'),
  ];
  return candidates.find((candidate) => candidate && existsSync(join(candidate, 'platform-tools'))) ?? null;
}

/** The newest build-tools that has apksigner, or null. */
function apksigner(sdk) {
  const root = join(sdk, 'build-tools');
  if (!existsSync(root)) return null;
  const name = WINDOWS ? 'apksigner.bat' : 'apksigner';
  const versions = readdirSync(root).filter((v) => existsSync(join(root, v, name))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions.length ? join(root, versions[0], name) : null;
}

/**
 * The SHA-256 of the signing certificate, or null when unsigned. An APK with minSdk ≥ 24 is signed
 * with the v2/v3 schemes only (no META-INF), which keytool cannot see: apksigner reads it. An AAB
 * carries a JAR signature: keytool.
 */
function certificateFingerprint(file, sdk) {
  if (file.endsWith('.apk')) {
    const signer = apksigner(sdk);
    if (!signer) return null;
    const result = WINDOWS
      ? spawnSync('cmd.exe', ['/d', '/c', signer, 'verify', '--print-certs', file], { encoding: 'utf8', windowsHide: true })
      : spawnSync(signer, ['verify', '--print-certs', file], { encoding: 'utf8', windowsHide: true });
    const match = /certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(result.stdout ?? '');
    return match ? match[1].toUpperCase().match(/../g).join(':') : null;
  }
  const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', WINDOWS ? 'keytool.exe' : 'keytool') : 'keytool';
  const result = spawnSync(keytool, ['-printcert', '-jarfile', file], { encoding: 'utf8', windowsHide: true });
  const match = /SHA256:\s*([0-9A-F:]+)/i.exec(result.stdout ?? '');
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────── the steps ─────────────────────────

function checkEnvironment() {
  const { java, major } = jdkMajor();
  if (major < MIN_JDK) throw new Error(`Gradle needs a JDK ${MIN_JDK} or newer (JAVA_HOME or the PATH); found ${major || 'none'} at ${java}`);
  log('1/5', `java ${major} ${paint.dim(java)}`);
  const sdk = sdkDir();
  if (!sdk) throw new Error('no Android SDK found: set ANDROID_HOME (the folder with platform-tools/, platforms/, build-tools/)');
  log('1/5', `sdk ${paint.dim(sdk)}`);
  const localProperties = join(ANDROID, 'local.properties');
  if (!existsSync(localProperties)) {
    // Forward slashes on purpose: in a .properties file "C:\Users" reads as "C:Users".
    writeFileSync(localProperties, `sdk.dir=${sdk.split(sep).join('/')}\n`);
    log('1/5', `wrote ${paint.dim('mobile/android/local.properties')} (not committed)`);
  }
  if (!existsSync(join(MOBILE, 'node_modules', '@capacitor', 'cli'))) {
    log('1/5', 'mobile/node_modules missing: npm ci (Capacitor and the icon generator, nothing else)');
    runScript(WINDOWS ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: MOBILE });
  }
  return sdk;
}

function buildWeb() {
  const spin = spinner('vite build (android)');
  run(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { env: { ...process.env, CHAINMATE_TARGET: 'android' } });
  spin.stop();
  const www = join(DIST, 'www');
  if (!existsSync(join(www, 'index.html'))) throw new Error(`the web build left no index.html in ${www}`);
  log('2/5', `web build ${paint.dim('→ ' + relative(ROOT, www))}`);
}

function syncNative() {
  const spin = spinner('cap sync android');
  run(process.execPath, [join(MOBILE, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'], { cwd: MOBILE });
  spin.stop();
  log('3/5', 'cap sync android: the web copy is in the native project');
}

function gradle(task) {
  log('4/5', `gradle ${task} ${paint.dim('(the first run fetches the wrapper and dependencies: minutes)')}`);
  const signed = existsSync(join(ANDROID, 'keystore.properties'));
  if (RELEASE) log('4/5', signed ? 'signing with mobile/android/keystore.properties' : paint.amber(`no keystore.properties: the release ${AAB ? 'AAB' : 'APK'} stays UNSIGNED (Play refuses it; an unsigned APK does not install)`));
  runScript(join(ANDROID, WINDOWS ? 'gradlew.bat' : 'gradlew'), [task, '--console=plain', '-q'], { cwd: ANDROID, quiet: false });
}

/** Gradle's newest output of the kind asked for. */
function gradleOutput() {
  const extension = AAB ? '.aab' : '.apk';
  const folder = AAB
    ? join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release')
    : join(ANDROID, 'app', 'build', 'outputs', 'apk', RELEASE ? 'release' : 'debug');
  const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(extension)).map((f) => join(folder, f)) : [];
  if (!files.length) throw new Error(`Gradle finished but there is no ${extension} in ${folder}`);
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function install(sdk, file) {
  if (AAB) throw new Error('an AAB does not install through adb (it is for Play): build the APK');
  const adb = join(sdk, 'platform-tools', WINDOWS ? 'adb.exe' : 'adb');
  const devices = run(adb, ['devices']).stdout.split('\n').slice(1).map((line) => line.trim()).filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);
  if (!devices.length) throw new Error('adb sees no device (USB debugging off? the emulator not booted?)');
  if (devices.length > 1 && !SERIAL) throw new Error(`${devices.length} devices (${devices.join(', ')}): pick one with --serial`);
  const device = SERIAL ?? devices[0];
  const output = run(adb, ['-s', device, 'install', '-r', file]).stdout;
  if (!/Success/.test(output)) throw new Error(`adb install: ${output.trim()}`);
  log('5/5', `installed on ${device}`);
  if (RUN) {
    const start = run(adb, ['-s', device, 'shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]).stdout;
    log('5/5', `opened ${paint.dim(`${(/TotalTime:\s*(\d+)/.exec(start) ?? [, '?'])[1]} ms`)}`);
  }
  return device;
}

// ─────────────────────────────────────────────────────────────── main ──────────────────────────────

function main() {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const versionCode = version.split('.').reduce((code, part) => code * 100 + Number(part), 0);
  console.log(`\n  ${paint.mauve('Chainmate for Android')}  ${paint.dim('·')} ${AAB ? 'AAB' : 'APK'} ${version} ${paint.dim(RELEASE ? '· release' : '· debug')}\n`);

  const sdk = checkEnvironment();
  if (GRADLE_ONLY) log('2/5', paint.dim('web build and cap sync skipped (--gradle-only)'));
  else {
    buildWeb();
    syncNative();
  }
  gradle(AAB ? 'bundleRelease' : RELEASE ? 'assembleRelease' : 'assembleDebug');

  const built = gradleOutput();
  const fingerprint = RELEASE ? certificateFingerprint(built, sdk) : null;
  const unsigned = RELEASE && !fingerprint;
  const suffix = RELEASE ? (unsigned ? '-unsigned' : '') : '-debug';
  mkdirSync(DIST, { recursive: true });
  const target = join(DIST, `Chainmate-${version}${suffix}${AAB ? '.aab' : '.apk'}`);
  copyFileSync(built, target);
  const bytes = statSync(target).size;
  const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');

  let device = null;
  if (INSTALL) {
    if (unsigned) throw new Error('an unsigned APK does not install: add keystore.properties, or build without --release (debug key)');
    device = install(sdk, target);
  }

  const kind = RELEASE ? (unsigned ? paint.amber('release, unsigned') : paint.green('release, signed')) : paint.teal('debug');
  card('Chainmate for Android', [
    [paint.green('✓'), `${AAB ? 'AAB' : 'APK'} ${version}`, paint.dim(`versionCode ${versionCode}`)],
    [paint.dim('kind   '), kind],
    [paint.dim('size   '), MB(bytes)],
    [paint.dim('sha256 '), paint.dim(sha256)],
    ...(fingerprint ? [[paint.dim('cert   '), paint.dim(`SHA-256 ${fingerprint}`)]] : []),
    [paint.dim('file   '), relative(ROOT, target)],
    ...(device ? [[paint.dim('device '), `${device}${RUN ? ' · opened' : ''}`]] : []),
    [paint.dim('time   '), elapsed()],
  ]);
}

try {
  main();
} catch (error) {
  console.error(paint.red(`\n✗ ${error.message}\n`));
  process.exitCode = 1;
}
