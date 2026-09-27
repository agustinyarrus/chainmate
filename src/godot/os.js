/**
 * OS — the few OS queries the game makes, answered for the browser / Android WebView.
 *
 * Godot's user command-line arguments (`-- --capture --seed=X`) come from the URL query string:
 * `?capture&seed=X` → ['--capture', '--seed=X'].
 */
const params = new URLSearchParams(globalThis.location?.search ?? '');

const isNativeApp = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());
const isStandalone = () => Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches);

export const OS = {
  get_cmdline_user_args() {
    const out = [];
    for (const [key, value] of params) out.push(value === '' ? `--${key}` : `--${key}=${value}`);
    return out;
  },
  /** 'web' = a plain browser tab (no Quit button, like Godot's web export). */
  has_feature(name) {
    if (name === 'web') return !isNativeApp() && !isStandalone() && !params.has('capture') && !params.has('app');
    if (name === 'android') return isNativeApp() && /android/i.test(globalThis.navigator?.userAgent ?? '');
    if (name === 'mobile') return /android|iphone|ipad/i.test(globalThis.navigator?.userAgent ?? '');
    return false;
  },
  get_processor_count() {
    return globalThis.navigator?.hardwareConcurrency ?? 4;
  },
  /** Leaves the app when that means something (native shell or a standalone window). */
  quit() {
    if (isNativeApp()) globalThis.Capacitor?.Plugins?.App?.exitApp?.();
    else globalThis.close?.();
  },
};

/** `Time.get_ticks_usec()` / `get_ticks_msec()` */
export const Time = {
  get_ticks_usec: () => Math.round(performance.now() * 1000),
  get_ticks_msec: () => Math.round(performance.now()),
  /** "YYYY-MM-DD", like Time.get_date_string_from_system(). */
  get_date_string_from_system() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
};

/** Storage that never throws (private windows, blocked storage, quota): Godot's user:// folder. */
export const UserStore = {
  read(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch (error) {
      console.warn(`storage read ${key} failed:`, error);
      return null;
    }
  },
  write(key, text) {
    try {
      globalThis.localStorage?.setItem(key, text);
      return true;
    } catch (error) {
      console.warn(`storage write ${key} failed:`, error);
      return false;
    }
  },
  remove(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch (error) {
      console.warn(`storage remove ${key} failed:`, error);
    }
  },
};
