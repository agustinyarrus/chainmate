/**
 * Tween — Godot 4's Tween semantics: a sequence of steps, each step a set of parallel tweeners.
 *
 *   tween_property(obj, "path[:sub]", final, duration)   starts from the value AT STEP START
 *   tween_method(fn, from, to, duration) · tween_callback(fn) · tween_interval(seconds)
 *   parallel() joins the next tweener to the current step; set_parallel(true) makes that the default;
 *   chain() opens a new step; set_trans/set_ease set defaults for tweeners created afterwards.
 *
 * Easing equations are Robert Penner's as written in Godot's tween_easing.h (TRANS_* × EASE_*).
 * A Tween bound to a node stops when the node leaves the tree (Godot kills it on free).
 * `finished` is a Signal emitted right after the last step, before the next tween is processed.
 */
import { Signal } from './signal.js';

export const TRANS = Object.freeze({ LINEAR: 0, SINE: 1, QUINT: 2, QUART: 3, QUAD: 4, EXPO: 5, ELASTIC: 6, CUBIC: 7, CIRC: 8, BOUNCE: 9, BACK: 10, SPRING: 11 });
export const EASE = Object.freeze({ IN: 0, OUT: 1, IN_OUT: 2, OUT_IN: 3 });

const PI = Math.PI;

// Each family: in/out/in_out(t, b, c, d); out_in derived generically.
const linear = { in: (t, b, c, d) => (c * t) / d + b };
linear.out = linear.in;
linear.in_out = linear.in;

const sine = {
  in: (t, b, c, d) => -c * Math.cos((t / d) * (PI / 2)) + c + b,
  out: (t, b, c, d) => c * Math.sin((t / d) * (PI / 2)) + b,
  in_out: (t, b, c, d) => (-c / 2) * (Math.cos((PI * t) / d) - 1) + b,
};
const quint = {
  in: (t, b, c, d) => c * Math.pow(t / d, 5) + b,
  out: (t, b, c, d) => c * (Math.pow(t / d - 1, 5) + 1) + b,
  in_out: (t, b, c, d) => {
    t = (t / d) * 2;
    if (t < 1) return (c / 2) * Math.pow(t, 5) + b;
    return (c / 2) * (Math.pow(t - 2, 5) + 2) + b;
  },
};
const quart = {
  in: (t, b, c, d) => c * Math.pow(t / d, 4) + b,
  out: (t, b, c, d) => -c * (Math.pow(t / d - 1, 4) - 1) + b,
  in_out: (t, b, c, d) => {
    t = (t / d) * 2;
    if (t < 1) return (c / 2) * Math.pow(t, 4) + b;
    return (-c / 2) * (Math.pow(t - 2, 4) - 2) + b;
  },
};
const quad = {
  in: (t, b, c, d) => c * Math.pow(t / d, 2) + b,
  out: (t, b, c, d) => {
    t /= d;
    return -c * t * (t - 2) + b;
  },
  in_out: (t, b, c, d) => {
    t = (t / d) * 2;
    if (t < 1) return (c / 2) * Math.pow(t, 2) + b;
    return (-c / 2) * ((t - 1) * (t - 3) - 1) + b;
  },
};
const expo = {
  in: (t, b, c, d) => (t === 0 ? b : c * Math.pow(2, 10 * (t / d - 1)) + b - c * 0.001),
  out: (t, b, c, d) => (t === d ? b + c : c * 1.001 * (-Math.pow(2, (-10 * t) / d) + 1) + b),
  in_out: (t, b, c, d) => {
    if (t === 0) return b;
    if (t === d) return b + c;
    t = (t / d) * 2;
    if (t < 1) return (c / 2) * Math.pow(2, 10 * (t - 1)) + b - c * 0.0005;
    return (c / 2) * 1.0005 * (-Math.pow(2, -10 * (t - 1)) + 2) + b;
  },
};
const elastic = {
  in: (t, b, c, d) => {
    if (t === 0) return b;
    t /= d;
    if (t === 1) return b + c;
    t -= 1;
    const p = d * 0.3;
    const a = c * Math.pow(2, 10 * t);
    const s = p / 4;
    return -(a * Math.sin(((t * d - s) * (2 * PI)) / p)) + b;
  },
  out: (t, b, c, d) => {
    if (t === 0) return b;
    t /= d;
    if (t === 1) return b + c;
    const p = d * 0.3;
    const s = p / 4;
    return c * Math.pow(2, -10 * t) * Math.sin(((t * d - s) * (2 * PI)) / p) + c + b;
  },
  in_out: (t, b, c, d) => {
    if (t === 0) return b;
    if ((t /= d / 2) === 2) return b + c;
    const p = d * (0.3 * 1.5);
    let a = c;
    const s = p / 4;
    if (t < 1) {
      t -= 1;
      a *= Math.pow(2, 10 * t);
      return -0.5 * (a * Math.sin(((t * d - s) * (2 * PI)) / p)) + b;
    }
    t -= 1;
    a *= Math.pow(2, -10 * t);
    return a * Math.sin(((t * d - s) * (2 * PI)) / p) * 0.5 + c + b;
  },
};
const cubic = {
  in: (t, b, c, d) => {
    t /= d;
    return c * t * t * t + b;
  },
  out: (t, b, c, d) => {
    t = t / d - 1;
    return c * (t * t * t + 1) + b;
  },
  in_out: (t, b, c, d) => {
    t /= d / 2;
    if (t < 1) return (c / 2) * t * t * t + b;
    t -= 2;
    return (c / 2) * (t * t * t + 2) + b;
  },
};
const circ = {
  in: (t, b, c, d) => {
    t /= d;
    return -c * (Math.sqrt(1 - t * t) - 1) + b;
  },
  out: (t, b, c, d) => {
    t = t / d - 1;
    return c * Math.sqrt(1 - t * t) + b;
  },
  in_out: (t, b, c, d) => {
    t /= d / 2;
    if (t < 1) return (-c / 2) * (Math.sqrt(1 - t * t) - 1) + b;
    t -= 2;
    return (c / 2) * (Math.sqrt(1 - t * t) + 1) + b;
  },
};
const bounceOut = (t, b, c, d) => {
  t /= d;
  if (t < 1 / 2.75) return c * (7.5625 * t * t) + b;
  if (t < 2 / 2.75) {
    t -= 1.5 / 2.75;
    return c * (7.5625 * t * t + 0.75) + b;
  }
  if (t < 2.5 / 2.75) {
    t -= 2.25 / 2.75;
    return c * (7.5625 * t * t + 0.9375) + b;
  }
  t -= 2.625 / 2.75;
  return c * (7.5625 * t * t + 0.984375) + b;
};
const bounce = {
  out: bounceOut,
  in: (t, b, c, d) => c - bounceOut(d - t, 0, c, d) + b,
  in_out: (t, b, c, d) => (t < d / 2 ? bounce.in(t * 2, b, c / 2, d) : bounceOut(t * 2 - d, b + c / 2, c / 2, d)),
};
const back = {
  in: (t, b, c, d) => {
    const s = 1.70158;
    t /= d;
    return c * t * t * ((s + 1) * t - s) + b;
  },
  out: (t, b, c, d) => {
    const s = 1.70158;
    t = t / d - 1;
    return c * (t * t * ((s + 1) * t + s) + 1) + b;
  },
  in_out: (t, b, c, d) => {
    const s = 1.70158 * 1.525;
    t /= d / 2;
    if (t < 1) return (c / 2) * (t * t * ((s + 1) * t - s)) + b;
    t -= 2;
    return (c / 2) * (t * t * ((s + 1) * t + s) + 2) + b;
  },
};
const springOut = (t, b, c, d) => {
  t /= d;
  const s = 1 - t;
  t = (Math.sin(t * PI * (0.2 + 2.5 * t * t * t)) * Math.pow(s, 2.2) + t) * (1 + 1.2 * s);
  return c * t + b;
};
const spring = {
  out: springOut,
  in: (t, b, c, d) => c - springOut(d - t, 0, c, d) + b,
  in_out: (t, b, c, d) => (t < d / 2 ? spring.in(t * 2, b, c / 2, d) : springOut(t * 2 - d, b + c / 2, c / 2, d)),
};

const FAMILIES = [linear, sine, quint, quart, quad, expo, elastic, cubic, circ, bounce, back, spring];

/** Godot's `Tween.interpolate_value` equation for one scalar. */
export function runEquation(trans, ease, t, b, c, d) {
  const family = FAMILIES[trans] ?? linear;
  switch (ease) {
    case EASE.IN:
      return family.in(t, b, c, d);
    case EASE.OUT:
      return family.out(t, b, c, d);
    case EASE.IN_OUT:
      return family.in_out(t, b, c, d);
    case EASE.OUT_IN:
      if (t < d / 2) return family.out(t * 2, b, c / 2, d);
      return family.in(t * 2 - d, b + c / 2, c / 2, d);
    default:
      return family.in_out(t, b, c, d);
  }
}

/** Interpolates numbers, or objects with numeric components (Vector2/3, Color) by component. */
function interpolate(initial, final, trans, ease, time, duration) {
  if (typeof initial === 'number') return runEquation(trans, ease, time, initial, final - initial, duration);
  const Ctor = initial.constructor;
  if ('a' in initial && 'r' in initial) {
    return new Ctor(
      runEquation(trans, ease, time, initial.r, final.r - initial.r, duration),
      runEquation(trans, ease, time, initial.g, final.g - initial.g, duration),
      runEquation(trans, ease, time, initial.b, final.b - initial.b, duration),
      runEquation(trans, ease, time, initial.a, final.a - initial.a, duration),
    );
  }
  if ('z' in initial) {
    return new Ctor(
      runEquation(trans, ease, time, initial.x, final.x - initial.x, duration),
      runEquation(trans, ease, time, initial.y, final.y - initial.y, duration),
      runEquation(trans, ease, time, initial.z, final.z - initial.z, duration),
    );
  }
  return new Ctor(
    runEquation(trans, ease, time, initial.x, final.x - initial.x, duration),
    runEquation(trans, ease, time, initial.y, final.y - initial.y, duration),
  );
}

/**
 * Property access with Godot's "prop:sub" paths. Targets expose plain properties (getters/setters);
 * a sub-path reads the value, replaces one component on a copy, and writes the whole value back.
 */
export function getPath(target, path) {
  const [prop, sub] = path.split(':');
  const value = target[prop];
  return sub ? value[sub] : value;
}

export function setPath(target, path, value) {
  const [prop, sub] = path.split(':');
  if (!sub) {
    target[prop] = value;
    return;
  }
  const whole = target[prop];
  const copy = typeof whole.clone === 'function' ? whole.clone() : { ...whole };
  copy[sub] = value;
  target[prop] = copy;
}

class Tweener {
  constructor(tween) {
    this.tween = tween;
    this.trans = tween._trans;
    this.ease = tween._ease;
    this.delay = 0;
    this.elapsed = 0;
    this.finished = false;
    this.started = false;
  }
  set_trans(trans) {
    this.trans = trans;
    return this;
  }
  set_ease(ease) {
    this.ease = ease;
    return this;
  }
  set_delay(seconds) {
    this.delay = seconds;
    return this;
  }
  start() {
    this.elapsed = 0;
    this.finished = false;
    this.started = false;
  }
  /** Returns the unused remainder of `delta` (or -1 while still running). */
  step(delta) {
    this.elapsed += delta;
    if (this.elapsed < this.delay) return -1;
    if (!this.started) {
      this.started = true;
      this._begin();
    }
    return this._advance(this.elapsed - this.delay);
  }
  _begin() {}
}

class PropertyTweener extends Tweener {
  constructor(tween, target, path, final, duration) {
    super(tween);
    this.target = target;
    this.path = path;
    this.final = final;
    this.duration = duration;
    this.initial = null;
    this.relative = false;
    this.fromValue = undefined;
  }
  from(value) {
    this.fromValue = value;
    return this;
  }
  from_current() {
    this.fromValue = undefined;
    return this;
  }
  as_relative() {
    this.relative = true;
    return this;
  }
  _begin() {
    this.initial = this.fromValue !== undefined ? this.fromValue : getPath(this.target, this.path);
    if (this.relative) {
      this.final = typeof this.initial === 'number' ? this.initial + this.final : this.initial.add(this.final);
    }
  }
  _advance(time) {
    if (this.tween._targetGone(this.target)) {
      this.finished = true;
      return 0;
    }
    if (time >= this.duration) {
      setPath(this.target, this.path, this.final);
      this.finished = true;
      return time - this.duration;
    }
    setPath(this.target, this.path, interpolate(this.initial, this.final, this.trans, this.ease, time, this.duration));
    return -1;
  }
}

class MethodTweener extends Tweener {
  constructor(tween, method, from, to, duration) {
    super(tween);
    this.method = method;
    this.fromValue = from;
    this.to = to;
    this.duration = duration;
  }
  _advance(time) {
    if (time >= this.duration) {
      this.method(this.to);
      this.finished = true;
      return time - this.duration;
    }
    this.method(interpolate(this.fromValue, this.to, this.trans, this.ease, time, this.duration));
    return -1;
  }
}

class CallbackTweener extends Tweener {
  constructor(tween, callback) {
    super(tween);
    this.callback = callback;
  }
  _advance(time) {
    this.finished = true;
    this.callback();
    return time;
  }
}

class IntervalTweener extends Tweener {
  constructor(tween, seconds) {
    super(tween);
    this.duration = seconds;
  }
  _advance(time) {
    if (time >= this.duration) {
      this.finished = true;
      return time - this.duration;
    }
    return -1;
  }
}

export class Tween {
  /** @param {object|null} owner node the tween is bound to (stops with it) */
  constructor(owner, registry) {
    this.owner = owner;
    this.registry = registry;
    /** @type {Tweener[][]} */
    this.steps = [];
    this.current = 0;
    this._trans = TRANS.LINEAR;
    this._ease = EASE.IN_OUT;
    this._parallel = false;
    this._joinNext = false;
    this._chainNext = false;
    this.valid = true;
    this.running = true;
    this._startedStep = -1;
    this.finished = new Signal();
    registry.add(this);
  }

  set_trans(trans) {
    this._trans = trans;
    return this;
  }
  set_ease(ease) {
    this._ease = ease;
    return this;
  }
  set_parallel(on = true) {
    this._parallel = on;
    return this;
  }
  parallel() {
    this._joinNext = true;
    return this;
  }
  chain() {
    this._chainNext = true;
    return this;
  }

  _append(tweener) {
    const join = this.steps.length > 0 && !this._chainNext && (this._joinNext || this._parallel);
    if (join) this.steps[this.steps.length - 1].push(tweener);
    else this.steps.push([tweener]);
    this._joinNext = false;
    this._chainNext = false;
    return tweener;
  }

  tween_property(target, path, final, duration) {
    return this._append(new PropertyTweener(this, target, path, final, duration));
  }
  tween_method(method, from, to, duration) {
    return this._append(new MethodTweener(this, method, from, to, duration));
  }
  tween_callback(callback) {
    return this._append(new CallbackTweener(this, callback));
  }
  tween_interval(seconds) {
    return this._append(new IntervalTweener(this, seconds));
  }

  kill() {
    this.valid = false;
    this.running = false;
    this.registry.delete(this);
  }
  is_valid() {
    return this.valid;
  }
  is_running() {
    return this.valid && this.running;
  }
  _targetGone(target) {
    return target && target._freed === true;
  }

  /** Advances by `delta`; steps that finish early hand their leftover time to the next step. */
  step(delta) {
    if (!this.valid) return false;
    if (this.owner && (this.owner._freed || this.owner._inside === false)) {
      if (this.owner._freed) this.kill();
      return false;
    }
    let remaining = delta;
    while (this.current < this.steps.length) {
      const group = this.steps[this.current];
      if (this._startedStep !== this.current) {
        this._startedStep = this.current;
        for (const tweener of group) tweener.start();
      }
      let leftover = Infinity;
      let allDone = true;
      for (const tweener of group) {
        if (tweener.finished) continue;
        const rest = tweener.step(remaining);
        if (rest < 0) allDone = false;
        else leftover = Math.min(leftover, rest);
        if (!this.valid) return false;
      }
      if (!allDone) return true;
      remaining = Number.isFinite(leftover) ? leftover : 0;
      this.current += 1;
    }
    this.valid = false;
    this.running = false;
    this.registry.delete(this);
    this.finished.emit();
    return false;
  }
}
