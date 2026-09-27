/**
 * FreeType's fixed-point arithmetic, reproduced to the bit, for the numbers Godot's TextServerAdvanced
 * takes from FreeType: variable-font base advances (fvar → avar → HVAR in 16.16), their scaling to
 * 26.6 pixels at a size, and the rounded size metrics (ascender / descender).
 *
 * Every helper is the integer formula from ftcalc.c / ttgxvar.c / ftobjs.c; products stay below 2^53,
 * so plain doubles hold them exactly. All functions are O(1) except `normalizedCoords` (O(axes · map))
 * and `advanceUnits` (O(regions · axes), memoised per glyph by the caller).
 */

/** FT_MOVE_SIGN-style helpers: operate on magnitudes, re-apply the sign. */
const sign = (x) => (x < 0 ? -1 : 1);

/** FT_DivFix(a, b) = (a·65536 + b/2) / b on magnitudes. */
export function divFix(a, b) {
  const s = sign(a) * sign(b);
  const ua = Math.abs(a);
  const ub = Math.abs(b);
  if (ub === 0) return s * 0x7fffffff;
  return s * Math.floor((ua * 65536 + Math.floor(ub / 2)) / ub);
}

/** FT_MulDiv(a, b, c) = (a·b + c/2) / c on magnitudes. */
export function mulDiv(a, b, c) {
  const s = sign(a) * sign(b) * sign(c);
  const ua = Math.abs(a);
  const ub = Math.abs(b);
  const uc = Math.abs(c);
  if (uc === 0) return s * 0x7fffffff;
  return s * Math.floor((ua * ub + Math.floor(uc / 2)) / uc);
}

/** FT_MulFix(a, b) = (a·b + 0x8000) >> 16 on magnitudes. */
export function mulFix(a, b) {
  const s = sign(a) * sign(b);
  return s * Math.floor((Math.abs(a) * Math.abs(b) + 0x8000) / 65536);
}

/** FT_MulAddFix: Σ s·f in 64 bits, then (t + 0x8000) >> 16 (arithmetic shift: floor). */
export function mulAddFix(scalars, factors) {
  let total = 0;
  for (let i = 0; i < scalars.length; i++) total += scalars[i] * factors[i];
  return Math.floor((total + 0x8000) / 65536);
}

export const PIX_CEIL = (x) => Math.floor((x + 63) / 64) * 64;
export const PIX_FLOOR = (x) => Math.floor(x / 64) * 64;
export const PIX_ROUND = (x) => Math.floor((x + 32) / 64) * 64;

/**
 * ft_var_to_normalized: design coordinates (16.16) → [-1, 1] (16.16) → avar segment maps.
 * `design` maps axis tag → design value (e.g. { wght: 600 }); missing axes use their default.
 */
export function normalizedCoords(font, design) {
  return font.axes.map((axis, i) => {
    let coord = design[axis.tag] !== undefined ? Math.round(design[axis.tag] * 65536) : axis.def;
    coord = Math.min(Math.max(coord, axis.minimum), axis.maximum);
    let n = 0;
    if (coord > axis.def) n = coord >= axis.maximum ? 0x10000 : divFix(coord - axis.def, axis.maximum - axis.def);
    else if (coord < axis.def) n = coord <= axis.minimum ? -0x10000 : divFix(coord - axis.def, axis.def - axis.minimum);
    const map = font.avar?.[i];
    if (map) {
      for (let j = 1; j < map.length; j++) {
        if (n < map[j].from) {
          n = mulDiv(n - map[j - 1].from, map[j].to - map[j - 1].to, map[j].from - map[j - 1].from) + map[j - 1].to;
          break;
        }
      }
    }
    return n;
  });
}

/** tt_var_get_item_delta: region scalars in 16.16, blended with FT_MulAddFix. */
export function itemDelta(store, coords, outer, inner) {
  if (outer === 0xffff && inner === 0xffff) return 0;
  const data = store.data[outer];
  if (!data || data.regionIndexes.length === 0 || inner >= data.itemCount) return 0;
  const scalars = data.regionIndexes.map((regionIndex) => {
    let scalar = 0x10000;
    const region = store.regions[regionIndex];
    for (let j = 0; j < store.axisCount; j++) {
      const axis = region[j];
      const ncv = coords[j] ?? 0;
      if (axis.peak === ncv || axis.peak === 0) continue;
      if (ncv <= axis.start || ncv >= axis.end) return 0;
      if (ncv < axis.peak) scalar = mulDiv(scalar, ncv - axis.start, axis.peak - axis.start);
      else scalar = mulDiv(scalar, axis.end - ncv, axis.end - axis.peak);
    }
    return scalar;
  });
  return mulAddFix(scalars, data.row(inner));
}

/** Advance in font units at the given normalized coordinates (hmtx + HVAR, tt_hadvance_adjust). */
export function advanceUnits(font, coords, gid) {
  let advance = font.defaultAdvance(gid);
  if (font.hvar && coords.some((c) => c !== 0)) {
    const { outer, inner } = font.hvar.advanceMap ? font.hvar.advanceMap(gid) : { outer: 0, inner: gid };
    advance += itemDelta(font.hvar.store, coords, outer, inner);
  }
  return advance;
}

/** FT_Set_Pixel_Sizes(face, 0, size): x_scale = y_scale = FT_DivFix(size·64, units_per_EM). */
export const pixelScale = (font, size) => divFix(size * 64, font.upem);

/**
 * FT_Get_Advance (fast path, 16.16 px) then hb-ft's conversion to 26.6: (v + 512) >> 10.
 * Returns the advance in 1/64 px.
 */
export function advance26(font, units, scale) {
  const v = mulDiv(units, scale, 64);
  return Math.floor((v + 512) / 1024);
}

/** The scale hb-ft gives HarfBuzz: (x_scale · upem + 2^15) >> 16 (26.6 per em). */
export const harfbuzzScale = (font, scale) => Math.floor((scale * font.upem + 0x8000) / 65536);

/**
 * Size metrics as FreeType's request code rounds them (head flag 8 unset: ascender ceiled,
 * descender floored) — Godot's get_ascent / get_descent at that size, in pixels.
 */
export function sizeMetrics(font, size) {
  const scale = pixelScale(font, size);
  const useIntegerPpem = (font.headFlags & 8) !== 0;
  const ascender = mulFix(font.ascender, scale);
  const descender = mulFix(font.descender, scale);
  const asc = useIntegerPpem ? PIX_ROUND(ascender) : PIX_CEIL(ascender);
  const desc = useIntegerPpem ? PIX_ROUND(descender) : PIX_FLOOR(descender);
  return { ascent: asc / 64, descent: -desc / 64 };
}
