/**
 * Whole-run replay against the ORIGINAL game logic (oracle `_oracle/runs.json`, produced inside the
 * Godot build by `_oracle/probe_runs.gd`). Same policy as the capture-tour autopilot; after every
 * action the complete GameState.to_dict() — board, army, gold, relics, map AND the PCG state — must be
 * identical to Godot's. One mismatch anywhere (AI move, relic offer, rounding) breaks the chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../src/core/game_state.js';
import { Tactics } from '../src/core/tactics.js';
import { Relics } from '../src/core/relics.js';
import { Events } from '../src/core/events.js';
import { ChessRules } from '../src/core/chess_rules.js';
import { isEmpty } from '../src/core/board.js';
import { RandomNumberGenerator } from '../src/godot/rng.js';
import { loadOracle, ofKind } from './oracle.mjs';

const RUNS = [
  ['TOUR-7', 'standard', 'vanguard'],
  ['BENCH-0', 'apprentice', 'cavalry'],
  ['CHAINMATE', 'standard', 'phalanx'],
  ['  ñandú-9 ', 'standard', 'cathedral'],
  ['GRIND-42', 'grandmaster', 'vanguard'],
];
const STEP_LIMIT = 4000;

/** JSON round trip = the shape Godot's JSON.stringify printed. */
const normal = (value) => JSON.parse(JSON.stringify(value));

/** Path of the first difference between two JSON values (for readable failures). */
function firstDiff(a, b, path = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = firstDiff(a[key], b[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

function bestPiece(gs) {
  let best = '';
  let bestValue = -1;
  for (const entry of gs.army) {
    if (Math.trunc(entry.level) < GameState.MAX_LEVEL && entry.kind !== 'king') {
      const value = Math.trunc(ChessRules.MATERIAL[entry.kind]) * 10 + Math.trunc(entry.xp);
      if (value > bestValue) {
        bestValue = value;
        best = String(entry.id);
      }
    }
  }
  return best;
}

/** The capture-tour policy, action by action; `snap(action, gs)` receives every state. */
function play(seedText, difficulty, army, snap) {
  const gs = new GameState();
  gs.new_run({ seed: seedText, difficulty, army });
  snap('new_run', gs);
  const pilotRng = new RandomNumberGenerator();
  pilotRng.seed = 7;
  const seen = new Set();
  let guard = 0;
  while (gs.phase !== 'won' && gs.phase !== 'lost' && guard < STEP_LIMIT) {
    guard += 1;
    const choosingRelic = gs.phase === 'reward' && !gs.reward.relic_taken;
    if (gs.pending_levels.length > 0 && gs.phase !== 'battle' && !choosingRelic) {
      const choices = gs.current_level_choices();
      if (choices.length === 0) {
        gs.skip_level();
        snap('skip_level', gs);
      } else {
        gs.choose_level(choices[0]);
        snap(`choose_level ${choices[0]}`, gs);
      }
      continue;
    }
    switch (gs.phase) {
      case 'reward': {
        seen.add(`reward_${gs.reward.kind}`);
        if (!gs.reward.relic_taken) {
          const offered = gs.reward.relic_choices;
          let pick = String(offered[0]);
          for (const preferred of ['kibitzers_whisper', 'desperado_ribbon', 'fortress_stone']) if (offered.includes(preferred)) pick = preferred;
          if (gs.relics.length < Relics.MAX_EQUIPPED) {
            gs.take_relic(pick);
            snap(`take_relic ${pick}`, gs);
          } else {
            gs.skip_relic();
            snap('skip_relic', gs);
          }
          continue;
        }
        gs.leave();
        snap('leave reward', gs);
        break;
      }
      case 'map': {
        const nodes = gs.current_nodes();
        let index = 0;
        const labels = { merchant: 'stop_merchant', unknown: 'stop_event', rest: 'stop_rest', elite: 'reward_elite' };
        for (const kind of Object.keys(labels)) {
          if (!seen.has(labels[kind]) && nodes.includes(kind)) {
            index = nodes.indexOf(kind);
            break;
          }
        }
        gs.choose_node(index);
        snap(`choose_node ${index}`, gs);
        break;
      }
      case 'merchant':
        seen.add('stop_merchant');
        for (let i = 0; i < gs.shop.relics.length; i++) {
          if (gs.buy_relic(i)) {
            snap(`buy_relic ${i}`, gs);
            break;
          }
        }
        gs.leave();
        snap('leave merchant', gs);
        break;
      case 'rest':
        seen.add('stop_rest');
        if (!gs.rest_done) {
          let moved = gs.fallen.length > 0 ? gs.rest_revive(0) : gs.rest_train(bestPiece(gs));
          if (!moved) moved = gs.rest_fortify();
          snap('rest', gs);
          continue;
        }
        gs.leave();
        snap('leave rest', gs);
        break;
      case 'event':
        seen.add('stop_event');
        if (!gs.event.resolved) {
          const choices = Events.info(String(gs.event.id)).choices;
          for (let i = 0; i < choices.length; i++) {
            if (gs.event_choice_available(i)) {
              gs.event_choose(i);
              snap(`event_choose ${i}`, gs);
              break;
            }
          }
          continue;
        }
        gs.leave();
        snap('leave event', gs);
        break;
      case 'battle':
        battleStep(gs, pilotRng, seen, snap);
        break;
    }
  }
  return gs;
}

function battleStep(gs, pilotRng, seen, snap) {
  const battle = gs.battle;
  if (battle.outcome !== '') {
    gs.finish_battle();
    snap('finish_battle', gs);
    return;
  }
  if (!battle.is_player_turn()) {
    const records = gs.run_enemy_turn();
    const moves = records.map((r) => ('terrain' in r ? `terrain:${r.terrain.length}` : `${r.id}>${r.to.x},${r.to.y}`));
    snap(`enemy ${moves.join(' ')}`, gs);
    return;
  }
  if (battle.turn === 2 && !seen.has('hint')) {
    seen.add('hint');
    const hinted = gs.hint();
    snap(`hint ${isEmpty(hinted) ? '-' : `${hinted.id}>${hinted.to.x},${hinted.to.y}`}`, gs);
  }
  let allowed = battle.allowed_moves();
  if (battle.in_follow_up()) {
    allowed = allowed.filter((m) => !isEmpty(battle.board.piece_at(m.to)));
    if (allowed.length === 0) {
      battle.end_turn();
      snap('end_turn follow_up', gs);
      return;
    }
  }
  if (allowed.length === 0) {
    battle.end_turn();
    snap('end_turn pass', gs);
    return;
  }
  const move = Tactics.best_move(battle.board, true, 2, pilotRng, 0.0, allowed);
  battle.move(String(move.id), move.to);
  snap(`move ${move.id}>${move.to.x},${move.to.y}`, gs);
}

const oracle = loadOracle('runs');

for (let run = 0; run < RUNS.length; run++) {
  const [seedText, difficulty, army] = RUNS[run];
  test(`run ${run}: "${seedText}" · ${difficulty} · ${army} — every state identical to Godot`, () => {
    const expected = ofKind(oracle, 'step').filter((e) => e.run === run);
    const end = ofKind(oracle, 'run_end').find((e) => e.run === run);
    let n = 0;
    const gs = play(seedText, difficulty, army, (action, state) => {
      const want = expected[n];
      assert.ok(want, `the port took more steps than Godot (extra action "${action}")`);
      assert.equal(action, want.action, `step ${n + 1}: action`);
      const ours = normal(state.to_dict());
      const diff = firstDiff(ours, want.gs);
      assert.equal(diff, null, `step ${n + 1} (${action}) differs at ${diff}`);
      n += 1;
    });
    assert.equal(n, expected.length, 'same number of steps');
    assert.equal(gs.phase, end.phase);
    assert.equal(gs.encounters_won, end.encounters_won);
  });
}

test('save → load round trip mid-battle continues identically', () => {
  const gs = new GameState();
  gs.new_run({ seed: 'TOUR-7' });
  gs.skip_relic();
  gs.leave();
  gs.choose_node(0);
  const restored = GameState.from_dict(normal(gs.to_dict()));
  assert.ok(restored, 'from_dict accepted its own save');
  assert.deepEqual(normal(restored.to_dict()), normal(gs.to_dict()));
  const a = gs.battle.end_turn() && gs.run_enemy_turn();
  const b = restored.battle.end_turn() && restored.run_enemy_turn();
  assert.deepEqual(normal(restored.to_dict()), normal(gs.to_dict()), 'enemy replies identically after reload');
  assert.equal(a.length, b.length);
});

test('corrupt saves are refused, not half-loaded', () => {
  assert.equal(GameState.from_dict(null), null);
  assert.equal(GameState.from_dict({ version: 3 }), null);
  const gs = new GameState();
  gs.new_run({ seed: 'EDGE' });
  const data = normal(gs.to_dict());
  data.army = [];
  assert.equal(GameState.from_dict(data), null, 'empty army');
  const data2 = normal(gs.to_dict());
  data2.relics = ['not_a_relic'];
  assert.equal(GameState.from_dict(data2), null, 'unknown relic');
});
