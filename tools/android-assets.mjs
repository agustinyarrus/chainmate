#!/usr/bin/env node
/**
 * android-assets — the Android icons and splash from the game's own icon (public/icon.svg), then
 * @capacitor/assets turns them into every density the launcher asks for.
 *
 *   node tools/android-assets.mjs            (mobile/node_modules must exist: cd mobile && npm install)
 *
 * Android's adaptive icon is two 108 dp layers of which the launcher shows the middle 72 dp, cut to
 * its own shape, and only a circle of 66 dp is guaranteed: the crown goes in the foreground, sized so
 * its farthest point stays inside that circle; the night backdrop fills the background edge to edge.
 *
 *   mobile/assets/icon-only.png        1024²  the whole icon (launchers without adaptive icons)
 *   mobile/assets/icon-foreground.png  1024²  the crown on transparency, inside the safe circle
 *   mobile/assets/icon-background.png  1024²  the backdrop gradient
 *   mobile/assets/splash.png, splash-dark.png  2732²  the crown on the loading screen's colour
 *
 * O(pixels) per image (sharp renders the SVG with librsvg).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { card, paint, spinner } from './term.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'mobile');
const OUT = join(MOBILE, 'assets');
const ICON_SVG = join(ROOT, 'public', 'icon.svg');

/** The icon's own coordinate system (viewBox 0 0 512 512) and the crown's extent in it. */
const ICON_UNITS = 512;
const CROWN_CENTRE = Object.freeze({ x: 256, y: 257 });
/** The farthest crown point from its centre, in icon units (the outer jewels and the shadow's ends). */
const CROWN_RADIUS = 175;
/** Adaptive icon geometry, in dp: the layer, and the circle every launcher mask keeps. */
const LAYER_DP = 108;
const SAFE_DIAMETER_DP = 66;
/** A little air inside the safe circle, so no mask grazes the jewels. */
const SAFE_MARGIN = 0.92;
const ICON_PX = 1024;
const SPLASH_PX = 2732;
/** The crown's height on the splash, as a share of its side. */
const SPLASH_CROWN_SHARE = 0.2;
const BACKDROP = '#07090d';

const require = createRequire(join(MOBILE, 'package.json'));
const sharp = require('sharp');

/** The crown's shapes, lifted out of icon.svg (every ellipse, polygon and circle after the backdrop). */
function crownShapes(svg) {
  const shapes = svg.match(/<(ellipse|polygon|circle)\b[^>]*\/>/g);
  if (!shapes || shapes.length < 8) throw new Error(`icon.svg: expected the crown's shapes, found ${shapes?.length ?? 0}`);
  return shapes.join('\n    ');
}

/** The backdrop's gradient definition, as icon.svg has it. */
function backdropGradient(svg) {
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(svg);
  if (!defs) throw new Error('icon.svg: no <defs> with the backdrop gradient');
  return defs[0];
}

/** An SVG of `size` px with the crown centred at `centre` px and scaled by `scale` px per icon unit. */
function crownSvg(shapes, size, scale, background = '') {
  const dx = size / 2 - CROWN_CENTRE.x * scale;
  const dy = size / 2 - CROWN_CENTRE.y * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background}
  <g transform="translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${scale.toFixed(6)})">
    ${shapes}
  </g>
</svg>`;
}

async function render(svg, file) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  return file;
}

async function main() {
  const spin = spinner('android assets');
  const svg = readFileSync(ICON_SVG, 'utf8');
  const shapes = crownShapes(svg);
  mkdirSync(OUT, { recursive: true });

  const pxPerDp = ICON_PX / LAYER_DP;
  const safeRadiusPx = (SAFE_DIAMETER_DP / 2) * pxPerDp * SAFE_MARGIN;
  const foregroundScale = safeRadiusPx / CROWN_RADIUS;
  const written = [];

  spin.tick('icon-only');
  written.push(await render(svg.replace('width="512" height="512"', `width="${ICON_PX}" height="${ICON_PX}"`), join(OUT, 'icon-only.png')));
  spin.tick('icon-foreground');
  written.push(await render(crownSvg(shapes, ICON_PX, foregroundScale), join(OUT, 'icon-foreground.png')));
  spin.tick('icon-background');
  written.push(await render(`<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_PX}" height="${ICON_PX}" viewBox="0 0 ${ICON_UNITS} ${ICON_UNITS}">
  ${backdropGradient(svg)}
  <rect width="${ICON_UNITS}" height="${ICON_UNITS}" fill="url(#night)"/>
</svg>`, join(OUT, 'icon-background.png')));
  const splashScale = (SPLASH_PX * SPLASH_CROWN_SHARE) / (2 * CROWN_RADIUS);
  const splash = crownSvg(shapes, SPLASH_PX, splashScale, `<rect width="${SPLASH_PX}" height="${SPLASH_PX}" fill="${BACKDROP}"/>`);
  spin.tick('splash');
  written.push(await render(splash, join(OUT, 'splash.png')));
  written.push(await render(splash, join(OUT, 'splash-dark.png')));

  spin.tick('capacitor-assets generate --android');
  const cli = join(MOBILE, 'node_modules', '@capacitor', 'assets', 'bin', 'capacitor-assets');
  const result = spawnSync(process.execPath, [cli, 'generate', '--android', '--iconBackgroundColor', BACKDROP, '--splashBackgroundColor', BACKDROP], { cwd: MOBILE, encoding: 'utf8', windowsHide: true });
  spin.stop();
  if (result.status !== 0) throw new Error(`capacitor-assets failed (${result.status}):\n${result.stderr || result.stdout}`);
  const generated = (result.stdout.match(/^(CREATE|UPDATE) /gm) ?? []).length;
  if (generated === 0) throw new Error(`capacitor-assets wrote nothing:\n${result.stdout}`);

  card('android assets', [
    [paint.green('✓'), `${written.length} sources`, paint.dim(`→ ${OUT.replace(ROOT, '.')}`)],
    [paint.dim('crown'), `its outer circle ${((2 * CROWN_RADIUS * foregroundScale) / pxPerDp).toFixed(1)} dp, inside the ${SAFE_DIAMETER_DP} dp every launcher mask keeps`],
    [paint.dim('android'), `${generated} launcher and splash files written by @capacitor/assets`],
  ]);
}

main().catch((error) => {
  console.error(paint.red(`\n✗ ${error.stack ?? error.message}`));
  process.exitCode = 1;
});
