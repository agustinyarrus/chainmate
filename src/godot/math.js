/**
 * Godot 4 math types with the engine's single-precision semantics.
 *
 * In a standard Godot build `real_t` is float: every Vector3/Color/Basis component is a float32 and
 * every operation rounds to float32 (a double scalar is first converted to float, then multiplied).
 * GDScript scalars stay doubles. Reproducing that split exactly is what keeps procedural layouts
 * (arena stones, piece lathes, relic parts) identical to the original build — the rounding decides
 * branches like `size.x > size.z * 1.55`. Verified against `_oracle/primitives.json` (`vec32`).
 *
 * Doing `Math.fround(a op b)` on two float32 inputs gives the correctly rounded float32 result for
 * + − × ÷ and sqrt (a double has more than 2·24+2 bits, so double rounding is innocuous).
 *
 * API mirrors Godot's (snake_case) so ported code reads like the GDScript it came from. Operations
 * return new values; the few mutators are explicit (`set_index`, property setters round to float32).
 */

export const F = Math.fround;
export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const INF = Infinity;
export const CMP_EPSILON = 0.00001;

const f32 = (v) => F(v);

// ───────────────────────────────────────────────────────────────────────── Vector2 ─────────────

export class Vector2 {
  constructor(x = 0, y = 0) {
    this._x = F(x);
    this._y = F(y);
  }
  get x() { return this._x; }
  set x(v) { this._x = F(v); }
  get y() { return this._y; }
  set y(v) { this._y = F(v); }

  static get ZERO() { return new Vector2(0, 0); }
  static get ONE() { return new Vector2(1, 1); }

  clone() { return new Vector2(this._x, this._y); }
  add(o) { return new Vector2(this._x + o._x, this._y + o._y); }
  sub(o) { return new Vector2(this._x - o._x, this._y - o._y); }
  /** `v * s` (scalar, converted to float first) or `v * w` (component-wise). */
  mul(s) {
    if (typeof s === 'number') {
      const k = F(s);
      return new Vector2(this._x * k, this._y * k);
    }
    return new Vector2(this._x * s._x, this._y * s._y);
  }
  div(s) {
    if (typeof s === 'number') {
      const k = F(s);
      return new Vector2(this._x / k, this._y / k);
    }
    return new Vector2(this._x / s._x, this._y / s._y);
  }
  neg() { return new Vector2(-this._x, -this._y); }
  dot(o) { return F(F(this._x * o._x) + F(this._y * o._y)); }
  cross(o) { return F(F(this._x * o._y) - F(this._y * o._x)); }
  length_squared() { return F(F(this._x * this._x) + F(this._y * this._y)); }
  length() { return F(Math.sqrt(this.length_squared())); }
  normalized() {
    const l = this.length_squared();
    if (l === 0) return new Vector2(0, 0);
    const len = F(Math.sqrt(l));
    return new Vector2(this._x / len, this._y / len);
  }
  distance_to(o) { return o.sub(this).length(); }
  distance_squared_to(o) { return o.sub(this).length_squared(); }
  /** Godot: `x + (to.x - x) * weight` per component, weight as float. */
  lerp(to, weight) {
    const w = F(weight);
    return new Vector2(this._x + F(F(to._x - this._x) * w), this._y + F(F(to._y - this._y) * w));
  }
  abs() { return new Vector2(Math.abs(this._x), Math.abs(this._y)); }
  min(o) { return new Vector2(Math.min(this._x, o._x), Math.min(this._y, o._y)); }
  max(o) { return new Vector2(Math.max(this._x, o._x), Math.max(this._y, o._y)); }
  clamp(lo, hi) { return new Vector2(Math.min(Math.max(this._x, lo._x), hi._x), Math.min(Math.max(this._y, lo._y), hi._y)); }
  angle() { return F(Math.atan2(this._y, this._x)); }
  rotated(angle) {
    const s = F(Math.sin(F(angle)));
    const c = F(Math.cos(F(angle)));
    return new Vector2(F(this._x * c) - F(this._y * s), F(this._x * s) + F(this._y * c));
  }
  equals(o) { return o instanceof Vector2 && this._x === o._x && this._y === o._y; }
  toString() { return `(${this._x}, ${this._y})`; }
}

// ───────────────────────────────────────────────────────────────────────── Vector2i ────────────

export class Vector2i {
  constructor(x = 0, y = 0) {
    this.x = x | 0;
    this.y = y | 0;
  }
  static get ZERO() { return new Vector2i(0, 0); }
  clone() { return new Vector2i(this.x, this.y); }
  add(o) { return new Vector2i(this.x + o.x, this.y + o.y); }
  sub(o) { return new Vector2i(this.x - o.x, this.y - o.y); }
  mul(k) { return typeof k === 'number' ? new Vector2i(this.x * k, this.y * k) : new Vector2i(this.x * k.x, this.y * k.y); }
  abs() { return new Vector2i(Math.abs(this.x), Math.abs(this.y)); }
  clamp(lo, hi) { return new Vector2i(Math.min(Math.max(this.x, lo.x), hi.x), Math.min(Math.max(this.y, lo.y), hi.y)); }
  equals(o) { return o instanceof Vector2i && this.x === o.x && this.y === o.y; }
  /** Canonical key for maps keyed by cell (Godot dictionaries hash by value). */
  key() { return `${this.x},${this.y}`; }
  toString() { return `(${this.x}, ${this.y})`; }
}

// ───────────────────────────────────────────────────────────────────────── Vector3 ─────────────

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this._x = F(x);
    this._y = F(y);
    this._z = F(z);
  }
  get x() { return this._x; }
  set x(v) { this._x = F(v); }
  get y() { return this._y; }
  set y(v) { this._y = F(v); }
  get z() { return this._z; }
  set z(v) { this._z = F(v); }

  static get ZERO() { return new Vector3(0, 0, 0); }
  static get ONE() { return new Vector3(1, 1, 1); }
  static get UP() { return new Vector3(0, 1, 0); }
  static get DOWN() { return new Vector3(0, -1, 0); }
  static get RIGHT() { return new Vector3(1, 0, 0); }
  static get LEFT() { return new Vector3(-1, 0, 0); }
  static get FORWARD() { return new Vector3(0, 0, -1); }
  static get BACK() { return new Vector3(0, 0, 1); }

  clone() { return new Vector3(this._x, this._y, this._z); }
  /** `v[i]` */
  get_index(i) { return i === 0 ? this._x : i === 1 ? this._y : this._z; }
  /** `v[i] = value` (mutates; used on fresh locals only). */
  set_index(i, value) {
    if (i === 0) this._x = F(value);
    else if (i === 1) this._y = F(value);
    else this._z = F(value);
  }
  add(o) { return new Vector3(this._x + o._x, this._y + o._y, this._z + o._z); }
  sub(o) { return new Vector3(this._x - o._x, this._y - o._y, this._z - o._z); }
  mul(s) {
    if (typeof s === 'number') {
      const k = F(s);
      return new Vector3(this._x * k, this._y * k, this._z * k);
    }
    return new Vector3(this._x * s._x, this._y * s._y, this._z * s._z);
  }
  div(s) {
    if (typeof s === 'number') {
      const k = F(s);
      return new Vector3(this._x / k, this._y / k, this._z / k);
    }
    return new Vector3(this._x / s._x, this._y / s._y, this._z / s._z);
  }
  neg() { return new Vector3(-this._x, -this._y, -this._z); }
  dot(o) { return F(F(F(this._x * o._x) + F(this._y * o._y)) + F(this._z * o._z)); }
  cross(o) {
    return new Vector3(
      F(this._y * o._z) - F(this._z * o._y),
      F(this._z * o._x) - F(this._x * o._z),
      F(this._x * o._y) - F(this._y * o._x),
    );
  }
  length_squared() { return F(F(F(this._x * this._x) + F(this._y * this._y)) + F(this._z * this._z)); }
  length() { return F(Math.sqrt(this.length_squared())); }
  normalized() {
    const l = this.length_squared();
    if (l === 0) return new Vector3(0, 0, 0);
    const len = F(Math.sqrt(l));
    return new Vector3(this._x / len, this._y / len, this._z / len);
  }
  distance_to(o) { return o.sub(this).length(); }
  distance_squared_to(o) { return o.sub(this).length_squared(); }
  lerp(to, weight) {
    const w = F(weight);
    return new Vector3(
      this._x + F(F(to._x - this._x) * w),
      this._y + F(F(to._y - this._y) * w),
      this._z + F(F(to._z - this._z) * w),
    );
  }
  abs() { return new Vector3(Math.abs(this._x), Math.abs(this._y), Math.abs(this._z)); }
  min(o) { return new Vector3(Math.min(this._x, o._x), Math.min(this._y, o._y), Math.min(this._z, o._z)); }
  max(o) { return new Vector3(Math.max(this._x, o._x), Math.max(this._y, o._y), Math.max(this._z, o._z)); }
  clamp(lo, hi) {
    return new Vector3(
      Math.min(Math.max(this._x, lo._x), hi._x),
      Math.min(Math.max(this._y, lo._y), hi._y),
      Math.min(Math.max(this._z, lo._z), hi._z),
    );
  }
  /** `v.rotated(axis, angle)` = Basis(axis, angle) * v. */
  rotated(axis, angle) { return Basis.from_axis_angle(axis, angle).xform(this); }
  is_zero_approx() {
    return Math.abs(this._x) < CMP_EPSILON && Math.abs(this._y) < CMP_EPSILON && Math.abs(this._z) < CMP_EPSILON;
  }
  equals(o) { return o instanceof Vector3 && this._x === o._x && this._y === o._y && this._z === o._z; }
  key() { return `${this._x},${this._y},${this._z}`; }
  toString() { return `(${this._x}, ${this._y}, ${this._z})`; }
}

// ───────────────────────────────────────────────────────────────────────── Vector4 ─────────────

export class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 0) {
    this.x = F(x);
    this.y = F(y);
    this.z = F(z);
    this.w = F(w);
  }
  static get ZERO() { return new Vector4(0, 0, 0, 0); }
}

// ───────────────────────────────────────────────────────────────────────── Color ───────────────

const HEX_DIGITS = /^#?([0-9a-fA-F]{3,8})$/;

/** Color::get_r8 and friends: round(channel × 255) in single precision, clamped to a byte. O(1). */
export function colorByte(channel) {
  return Math.min(Math.max(Math.round(F(channel * 255)), 0), 255);
}

export class Color {
  /**
   * Color(r, g, b, a = 1) · Color("rrggbb[aa]") · Color(color, alpha)
   */
  constructor(r = 0, g = 0, b = 0, a = 1) {
    if (typeof r === 'string') {
      const [pr, pg, pb, pa] = Color._parseHtml(r);
      this.r = pr;
      this.g = pg;
      this.b = pb;
      // Color("hex") keeps the hex alpha; Color("hex", alpha) overrides it.
      this.a = arguments.length >= 2 ? F(g) : pa;
      return;
    }
    if (r instanceof Color) {
      this.r = r.r;
      this.g = r.g;
      this.b = r.b;
      this.a = arguments.length >= 2 ? F(g) : r.a;
      return;
    }
    this.r = F(r);
    this.g = F(g);
    this.b = F(b);
    this.a = F(a);
  }

  static _parseHtml(text) {
    const m = HEX_DIGITS.exec(text);
    if (!m) throw new Error(`invalid color "${text}"`);
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    const byte = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const alpha = hex.length === 8 ? byte(3) : 255;
    return [F(byte(0) / F(255)), F(byte(1) / F(255)), F(byte(2) / F(255)), F(alpha / F(255))];
  }

  static get WHITE() { return new Color(1, 1, 1, 1); }
  static get BLACK() { return new Color(0, 0, 0, 1); }
  static get TRANSPARENT() { return new Color(1, 1, 1, 0); }

  clone() { return new Color(this.r, this.g, this.b, this.a); }
  /** Color * scalar scales all four channels (alpha too), like Godot. */
  mul(s) {
    if (typeof s === 'number') {
      const k = F(s);
      return new Color(this.r * k, this.g * k, this.b * k, this.a * k);
    }
    return new Color(this.r * s.r, this.g * s.g, this.b * s.b, this.a * s.a);
  }
  lerp(to, weight) {
    const w = F(weight);
    return new Color(
      this.r + F(F(to.r - this.r) * w),
      this.g + F(F(to.g - this.g) * w),
      this.b + F(F(to.b - this.b) * w),
      this.a + F(F(to.a - this.a) * w),
    );
  }
  lightened(amount) {
    const k = F(amount);
    return new Color(this.r + F(F(1 - this.r) * k), this.g + F(F(1 - this.g) * k), this.b + F(F(1 - this.b) * k), this.a);
  }
  darkened(amount) {
    const k = F(1 - F(amount));
    return new Color(this.r * k, this.g * k, this.b * k, this.a);
  }
  // Godot 4.7 converts in double precision and stores the float (verified: the float32 formula is 1 ulp off).
  static _toLinear(c) {
    return c < 0.04045 ? F(c * (1 / 12.92)) : F(Math.pow((c + 0.055) * (1 / 1.055), 2.4));
  }
  static _toSrgb(c) {
    return c < 0.0031308 ? F(12.92 * c) : F(1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  }
  srgb_to_linear() { return new Color(Color._toLinear(this.r), Color._toLinear(this.g), Color._toLinear(this.b), this.a); }
  linear_to_srgb() { return new Color(Color._toSrgb(this.r), Color._toSrgb(this.g), Color._toSrgb(this.b), this.a); }
  /**
   * Godot's `to_html(with_alpha = true)` → "rrggbbaa". `_to_hex` rounds `p_val * 255.0f` computed in
   * float32 (0.9 → 229.5 → "e6"; in doubles it would be 229.49999… → "e5").
   */
  to_html(withAlpha = true) {
    const byte = (v) => {
      const scaled = F(F(v) * 255);
      const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
      return Math.min(Math.max(rounded, 0), 255).toString(16).padStart(2, '0');
    };
    return byte(this.r) + byte(this.g) + byte(this.b) + (withAlpha ? byte(this.a) : '');
  }
  equals(o) { return o instanceof Color && this.r === o.r && this.g === o.g && this.b === o.b && this.a === o.a; }
  /** CSS rgba() of the (sRGB) colour, for the DOM UI. */
  css(alphaScale = 1) {
    const c = (v) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
    return `rgba(${c(this.r)},${c(this.g)},${c(this.b)},${Math.min(Math.max(this.a * alphaScale, 0), 1)})`;
  }
  toString() { return `(${this.r}, ${this.g}, ${this.b}, ${this.a})`; }
}

// ───────────────────────────────────────────────────────────────────────── Basis ───────────────

/** Row-major 3×3 matrix (`rows[i][j]`), exactly Godot's storage; `x/y/z` getters return COLUMNS. */
export class Basis {
  constructor(r0 = new Vector3(1, 0, 0), r1 = new Vector3(0, 1, 0), r2 = new Vector3(0, 0, 1)) {
    this.rows = [r0, r1, r2];
  }

  /** Basis(axis, angle) — Rodrigues, float32 like `Basis::set_axis_angle`. */
  static from_axis_angle(axis, angle) {
    const a = F(angle);
    const ax = axis.x;
    const ay = axis.y;
    const az = axis.z;
    const sq = [F(ax * ax), F(ay * ay), F(az * az)];
    const cosine = F(Math.cos(a));
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    m[0][0] = F(sq[0] + F(cosine * F(1 - sq[0])));
    m[1][1] = F(sq[1] + F(cosine * F(1 - sq[1])));
    m[2][2] = F(sq[2] + F(cosine * F(1 - sq[2])));
    const sine = F(Math.sin(a));
    const t = F(1 - cosine);
    let xyzt = F(F(ax * ay) * t);
    let zyxs = F(az * sine);
    m[0][1] = F(xyzt - zyxs);
    m[1][0] = F(xyzt + zyxs);
    xyzt = F(F(ax * az) * t);
    zyxs = F(ay * sine);
    m[0][2] = F(xyzt + zyxs);
    m[2][0] = F(xyzt - zyxs);
    xyzt = F(F(ay * az) * t);
    zyxs = F(ax * sine);
    m[1][2] = F(xyzt - zyxs);
    m[2][1] = F(xyzt + zyxs);
    return Basis._fromArray(m);
  }

  static _fromArray(m) {
    return new Basis(new Vector3(m[0][0], m[0][1], m[0][2]), new Vector3(m[1][0], m[1][1], m[1][2]), new Vector3(m[2][0], m[2][1], m[2][2]));
  }

  /** Basis.from_scale(v) */
  static from_scale(s) {
    return new Basis(new Vector3(s.x, 0, 0), new Vector3(0, s.y, 0), new Vector3(0, 0, s.z));
  }

  /** Basis.from_euler(v, YXZ) — Godot's default rotation order (= THREE 'YXZ'). */
  static from_euler(euler) {
    let c = F(Math.cos(F(euler.x)));
    let s = F(Math.sin(F(euler.x)));
    const xmat = Basis._fromArray([[1, 0, 0], [0, c, -s], [0, s, c]]);
    c = F(Math.cos(F(euler.y)));
    s = F(Math.sin(F(euler.y)));
    const ymat = Basis._fromArray([[c, 0, s], [0, 1, 0], [-s, 0, c]]);
    c = F(Math.cos(F(euler.z)));
    s = F(Math.sin(F(euler.z)));
    const zmat = Basis._fromArray([[c, -s, 0], [s, c, 0], [0, 0, 1]]);
    return ymat.mul(xmat).mul(zmat);
  }

  /** Basis(Quaternion) — `Basis::set_quaternion`. */
  static from_quaternion(q) {
    const d = q.length_squared();
    const s = F(F(2) / d);
    const xs = F(q.x * s), ys = F(q.y * s), zs = F(q.z * s);
    const wx = F(q.w * xs), wy = F(q.w * ys), wz = F(q.w * zs);
    const xx = F(q.x * xs), xy = F(q.x * ys), xz = F(q.x * zs);
    const yy = F(q.y * ys), yz = F(q.y * zs), zz = F(q.z * zs);
    return Basis._fromArray([
      [F(1 - F(yy + zz)), F(xy - wz), F(xz + wy)],
      [F(xy + wz), F(1 - F(xx + zz)), F(yz - wx)],
      [F(xz - wy), F(yz + wx), F(1 - F(xx + yy))],
    ]);
  }

  /** Basis.looking_at(target, up, use_model_front = false) */
  static looking_at(target, up = Vector3.UP, useModelFront = false) {
    let vz = target.normalized();
    if (!useModelFront) vz = vz.neg();
    const vx = up.cross(vz).normalized();
    const vy = vz.cross(vx);
    return Basis.from_columns(vx, vy, vz);
  }

  static from_columns(cx, cy, cz) {
    return new Basis(new Vector3(cx.x, cy.x, cz.x), new Vector3(cx.y, cy.y, cz.y), new Vector3(cx.z, cy.z, cz.z));
  }

  get x() { return new Vector3(this.rows[0].x, this.rows[1].x, this.rows[2].x); }
  get y() { return new Vector3(this.rows[0].y, this.rows[1].y, this.rows[2].y); }
  get z() { return new Vector3(this.rows[0].z, this.rows[1].z, this.rows[2].z); }

  clone() { return new Basis(this.rows[0].clone(), this.rows[1].clone(), this.rows[2].clone()); }

  /** basis * basis (`Basis::operator*`: rows · columns, float32 dot products). */
  mul(o) {
    const cx = o.x;
    const cy = o.y;
    const cz = o.z;
    return new Basis(
      new Vector3(this.rows[0].dot(cx), this.rows[0].dot(cy), this.rows[0].dot(cz)),
      new Vector3(this.rows[1].dot(cx), this.rows[1].dot(cy), this.rows[1].dot(cz)),
      new Vector3(this.rows[2].dot(cx), this.rows[2].dot(cy), this.rows[2].dot(cz)),
    );
  }

  /** basis * vector */
  xform(v) { return new Vector3(this.rows[0].dot(v), this.rows[1].dot(v), this.rows[2].dot(v)); }

  transposed() {
    const r = this.rows;
    return new Basis(new Vector3(r[0].x, r[1].x, r[2].x), new Vector3(r[0].y, r[1].y, r[2].y), new Vector3(r[0].z, r[1].z, r[2].z));
  }

  determinant() {
    const r = this.rows;
    return F(
      F(F(r[0].x * F(F(r[1].y * r[2].z) - F(r[2].y * r[1].z))) - F(r[1].x * F(F(r[0].y * r[2].z) - F(r[2].y * r[0].z)))) +
        F(r[2].x * F(F(r[0].y * r[1].z) - F(r[1].y * r[0].z))),
    );
  }

  /** `Basis::inverse` (cofactors / determinant). */
  inverse() {
    const r = this.rows;
    const co = (r1, c1, r2, c2) => F(F(r[r1].get_index(c1) * r[r2].get_index(c2)) - F(r[r1].get_index(c2) * r[r2].get_index(c1)));
    const cofac00 = co(1, 1, 2, 2);
    const cofac10 = co(1, 2, 2, 0);
    const cofac20 = co(1, 0, 2, 1);
    const det = F(F(F(r[0].x * cofac00) + F(r[0].y * cofac10)) + F(r[0].z * cofac20));
    const s = F(1 / det);
    return Basis._fromArray([
      [F(cofac00 * s), F(co(0, 2, 2, 1) * s), F(co(0, 1, 1, 2) * s)],
      [F(cofac10 * s), F(co(0, 0, 2, 2) * s), F(co(0, 2, 1, 0) * s)],
      [F(cofac20 * s), F(co(0, 1, 2, 0) * s), F(co(0, 0, 1, 1) * s)],
    ]);
  }

  /** `basis.scaled(v)` = from_scale(v) * basis (scales the rows' world axes). */
  scaled(s) {
    return new Basis(this.rows[0].mul(s.x), this.rows[1].mul(s.y), this.rows[2].mul(s.z));
  }

  get_scale() {
    const det = this.determinant();
    const sign = det < 0 ? -1 : 1;
    return new Vector3(this.x.length(), this.y.length(), this.z.length()).mul(sign);
  }

  /** Column-major 16-array for THREE.Matrix4.fromArray (with an origin). */
  toMatrixArray(origin = Vector3.ZERO) {
    const r = this.rows;
    return [r[0].x, r[1].x, r[2].x, 0, r[0].y, r[1].y, r[2].y, 0, r[0].z, r[1].z, r[2].z, 0, origin.x, origin.y, origin.z, 1];
  }
}

// ───────────────────────────────────────────────────────────────────────── Transform3D ─────────

export class Transform3D {
  constructor(basis = new Basis(), origin = Vector3.ZERO) {
    this.basis = basis;
    this.origin = origin;
  }
  static get IDENTITY() { return new Transform3D(); }
  xform(v) { return this.basis.xform(v).add(this.origin); }
  toMatrixArray() { return this.basis.toMatrixArray(this.origin); }
}

// ───────────────────────────────────────────────────────────────────────── Quaternion ──────────

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = F(x);
    this.y = F(y);
    this.z = F(z);
    this.w = F(w);
  }
  /** Quaternion(arc_from, arc_to) — shortest arc between two unit vectors. */
  static from_arc(v0, v1) {
    const c = v0.cross(v1);
    const d = v0.dot(v1);
    if (d < F(-1 + CMP_EPSILON)) return new Quaternion(0, 1, 0, 0);
    const s = F(Math.sqrt(F(F(1 + d) * 2)));
    const rs = F(1 / s);
    return new Quaternion(F(c.x * rs), F(c.y * rs), F(c.z * rs), F(s * F(0.5)));
  }
  length_squared() { return F(F(F(F(this.x * this.x) + F(this.y * this.y)) + F(this.z * this.z)) + F(this.w * this.w)); }
}

// ───────────────────────────────────────────────────────────────────────── Rect2 ───────────────

export class Rect2 {
  constructor(position = Vector2.ZERO, size = Vector2.ZERO) {
    this.position = position;
    this.size = size;
  }
  static of(x, y, w, h) { return new Rect2(new Vector2(x, y), new Vector2(w, h)); }
  grow(by) {
    const g = F(by);
    return new Rect2(new Vector2(this.position.x - g, this.position.y - g), new Vector2(this.size.x + F(g * 2), this.size.y + F(g * 2)));
  }
  has_point(p) {
    if (p.x < this.position.x) return false;
    if (p.y < this.position.y) return false;
    if (p.x >= F(this.position.x + this.size.x)) return false;
    if (p.y >= F(this.position.y + this.size.y)) return false;
    return true;
  }
  get end() { return this.position.add(this.size); }
}

/** `AABB`: an axis-aligned box by its lowest corner and its size (single precision, like the engine's). */
export class AABB {
  constructor(position = Vector3.ZERO, size = Vector3.ZERO) {
    this.position = position;
    this.size = size;
  }
  get end() {
    return this.position.add(this.size);
  }
  /** AABB::get_center — position + size × 0.5. */
  get_center() {
    return new Vector3(F(this.position.x + F(this.size.x * 0.5)), F(this.position.y + F(this.size.y * 0.5)), F(this.position.z + F(this.size.z * 0.5)));
  }
  has_volume() {
    return this.size.x > 0 && this.size.y > 0 && this.size.z > 0;
  }
}

// ───────────────────────────────────────────────────────────────────────── scalar helpers ──────

/** GDScript `lerpf` (double precision, like the script VM). */
export const lerpf = (from, to, weight) => from + (to - from) * weight;
export const clampf = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const maxf = Math.max;
export const minf = Math.min;
export const maxi = Math.max;
export const mini = Math.min;
export const absf = Math.abs;
export const absi = Math.abs;
export const signf = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const signi = signf;
export const deg_to_rad = (deg) => deg * (Math.PI / 180);
export const rad_to_deg = (rad) => rad * (180 / Math.PI);
/** `fposmod` — floating modulo with the sign of the divisor. */
export function fposmod(x, y) {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value;
}
export function posmod(x, y) {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value;
}
/** GDScript `smoothstep(from, to, x)` — returns `from` when the edges coincide. */
export function smoothstep(from, to, x) {
  if (Math.abs(from - to) < CMP_EPSILON) return from;
  const s = clampf((x - from) / (to - from), 0, 1);
  return s * s * (3 - 2 * s);
}
/** Round half away from zero (C `round`), unlike `Math.round`. */
export const round = (v) => (v < 0 ? -Math.round(-v) : Math.round(v));
export const roundi = round;
/** `snappedf(value, step)` = floor(value / step + 0.5) * step */
export const snappedf = (value, step) => (step !== 0 ? Math.floor(value / step + 0.5) * step : value);
export const linear_to_db = (linear) => Math.log(linear) * 8.685889638065036553;
export const db_to_linear = (db) => Math.exp(db * 0.11512925464970228420);
/** GDScript `ease(x, curve)`. */
export function ease(x, c) {
  if (x < 0) x = 0;
  else if (x > 1) x = 1;
  if (c > 0) {
    if (c < 1) return 1 - Math.pow(1 - x, 1 / c);
    return Math.pow(x, c);
  }
  if (c < 0) {
    if (x < 0.5) return Math.pow(x * 2, -c) * 0.5;
    return (1 - Math.pow(1 - (x - 0.5) * 2, -c)) * 0.5 + 0.5;
  }
  return 0;
}
/** GDScript integer division: truncates toward zero. */
export const idiv = (a, b) => Math.trunc(a / b);
export const is_equal_approx = (a, b) => {
  if (a === b) return true;
  let tolerance = CMP_EPSILON * Math.abs(a);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(a - b) < tolerance;
};
