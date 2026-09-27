/**
 * Profile — port of scripts/autoload/profile.gd: lifetime records, unlocks, run history and the saved
 * run, stored as JSON in user storage (Godot's user:// folder → localStorage keys). Capture and
 * ephemeral runs use a sandbox; a capture run starts from a fresh profile, like the original.
 * A stored profile that fails validation is set aside ("…corrupt") and replaced by defaults.
 */
import { OS, Time, UserStore } from '../godot/os.js';
import { GameState } from '../core/game_state.js';

const PROFILE_VERSION = 2;
const HISTORY_LENGTH = 12;

const UNLOCKS = Object.freeze({
  army_cavalry: { name: 'Hussars army', hint: 'Defeat Lucena of the Long File, the first boss.' },
  army_cathedral: { name: 'Bishop Pair army', hint: 'Defeat Canon Oblique, the second boss.' },
  army_phalanx: { name: 'Pawn Chain army', hint: 'Win a run.' },
  difficulty_grandmaster: { name: 'Grandmaster difficulty', hint: 'Win a run on Tournament.' },
});

class ProfileAutoload {
  constructor() {
    this.UNLOCKS = UNLOCKS;
    this.data = {};
    this.recovered = false;
    this._folder = 'chainmate:';
  }

  _ready() {
    const args = OS.get_cmdline_user_args();
    if (args.includes('--capture') || args.includes('--ephemeral')) {
      this._folder = 'chainmate:sandbox:';
      if (args.includes('--capture')) {
        this.clear_run();
        this._write_json(`${this._folder}profile.json`, this._default_profile());
      }
    }
    const path = `${this._folder}profile.json`;
    const stored = this._read_json(path);
    if (stored === null) this.data = this._default_profile();
    else if (this._valid_profile(stored)) this.data = stored;
    else {
      const text = UserStore.read(path);
      if (text !== null) UserStore.write(`${path}.corrupt`, text);
      UserStore.remove(path);
      this.data = this._default_profile();
      this.recovered = true;
      this._save_profile();
    }
  }

  is_unlocked(id) {
    return this.data.unlocks.includes(id);
  }

  army_available(preset) {
    return preset === 'vanguard' || this.is_unlocked(`army_${preset}`);
  }

  difficulty_available(difficulty) {
    return difficulty !== 'grandmaster' || this.is_unlocked('difficulty_grandmaster');
  }

  unlock_hint(id) {
    return String(UNLOCKS[id].hint);
  }

  _unlock(id, fresh) {
    if (this.is_unlocked(id)) return;
    this.data.unlocks.push(id);
    fresh.push(id);
  }

  record_boss(gs) {
    const fresh = [];
    this.data.bosses = Math.trunc(this.data.bosses) + 1;
    if (gs.act >= 0) this._unlock('army_cavalry', fresh);
    if (gs.act >= 1) this._unlock('army_cathedral', fresh);
    this._save_profile();
    return fresh;
  }

  record_run_end(gs, won) {
    const fresh = [];
    const d = this.data;
    d.runs = Math.trunc(d.runs) + 1;
    d.total_captures = Math.trunc(d.total_captures) + Math.trunc(gs.stats.captures);
    d.best_chain = Math.max(Math.trunc(d.best_chain), Math.trunc(gs.stats.best_chain));
    d.best_encounters = Math.max(Math.trunc(d.best_encounters), gs.encounters_won);
    d.best_by_difficulty[gs.difficulty] = Math.max(Math.trunc(d.best_by_difficulty[gs.difficulty]), gs.encounters_won);
    if (won) {
      d.wins = Math.trunc(d.wins) + 1;
      d.wins_by_difficulty[gs.difficulty] = Math.trunc(d.wins_by_difficulty[gs.difficulty]) + 1;
      this._unlock('army_phalanx', fresh);
      if (gs.difficulty === 'standard' || gs.difficulty === 'grandmaster') this._unlock('difficulty_grandmaster', fresh);
    }
    d.history.unshift({
      won,
      encounters: gs.encounters_won,
      difficulty: gs.difficulty,
      army: gs.army_preset,
      seed: gs.seed_text,
      relics: [...gs.relics],
      survivors: gs.army.length,
      date: Time.get_date_string_from_system(),
    });
    while (d.history.length > HISTORY_LENGTH) d.history.pop();
    this._save_profile();
    return fresh;
  }

  best_for(difficulty) {
    return Math.trunc(this.data.best_by_difficulty[difficulty]);
  }

  mark_tutorial_done() {
    if (!this.data.tutorial_done) {
      this.data.tutorial_done = true;
      this._save_profile();
    }
  }

  save_run(gs) {
    if (gs === null || gs === undefined || gs.phase === 'lost' || gs.phase === 'won') {
      this.clear_run();
      return;
    }
    this._write_json(`${this._folder}run.json`, gs.to_dict());
  }

  load_run() {
    const stored = this._read_json(`${this._folder}run.json`);
    return stored !== null ? GameState.from_dict(stored) : null;
  }

  has_run() {
    return this.load_run() !== null;
  }

  clear_run() {
    UserStore.remove(`${this._folder}run.json`);
  }

  _default_profile() {
    const perDifficulty = {};
    for (const key of Object.keys(GameState.DIFFICULTIES)) perDifficulty[key] = 0;
    return {
      version: PROFILE_VERSION,
      runs: 0,
      wins: 0,
      bosses: 0,
      best_encounters: 0,
      best_chain: 0,
      total_captures: 0,
      best_by_difficulty: { ...perDifficulty },
      wins_by_difficulty: { ...perDifficulty },
      unlocks: [],
      history: [],
      tutorial_done: false,
    };
  }

  /** Same structural checks as the original (types of every default field, history entries). */
  _valid_profile(stored) {
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored) || Math.trunc(stored.version ?? -1) !== PROFILE_VERSION) return false;
    const reference = this._default_profile();
    const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    for (const key of Object.keys(reference)) {
      if (!(key in stored)) return false;
      if (kind(stored[key]) !== kind(reference[key])) return false;
    }
    for (const key of Object.keys(GameState.DIFFICULTIES)) {
      if (!(key in stored.best_by_difficulty) || !(key in stored.wins_by_difficulty)) return false;
    }
    for (const entry of stored.history) {
      if (kind(entry) !== 'object') return false;
      for (const field of ['won', 'encounters', 'difficulty', 'army', 'seed', 'survivors']) if (!(field in entry)) return false;
      if (!(String(entry.difficulty) in GameState.DIFFICULTIES) || !(String(entry.army) in GameState.ARMIES)) return false;
    }
    return true;
  }

  _save_profile() {
    this._write_json(`${this._folder}profile.json`, this.data);
  }

  _read_json(path) {
    const text = UserStore.read(path);
    if (text === null || text === '') return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      // JSON.parse_string returns null for unparsable text: treated like a missing file.
      console.warn(`${path} is not valid JSON:`, error);
      return null;
    }
  }

  _write_json(path, value) {
    if (!UserStore.write(path, JSON.stringify(value, null, '\t'))) console.warn(`Could not write ${path}`);
  }
}

export const Profile = new ProfileAutoload();
