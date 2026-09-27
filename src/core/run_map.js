/**
 * RunMap — port of scripts/core/run_map.gd: each act is five steps
 * (fight · 2–3 stops · fight-or-elite · 2–3 stops · boss).
 */
export class RunMap {
  static STEPS = 5;
  static STOP_TYPES = ['merchant', 'rest', 'unknown'];
  static FIGHTS = ['encounter', 'elite', 'boss'];
  static NODE_INFO = {
    encounter: { name: 'Encounter', desc: 'A standard fight.' },
    elite: { name: 'Elite', desc: 'A harder fight. Win a relic.' },
    merchant: { name: 'Merchant', desc: 'Relics, recruits, training and mending.' },
    rest: { name: 'Rest', desc: 'Revive a fallen piece, train one, or fortify the army.' },
    unknown: { name: 'Unknown', desc: 'Something waits on the road.' },
    boss: { name: 'Boss', desc: 'The master of this act.' },
  };

  static generate(rng) {
    return [['encounter'], RunMap._stops(rng), ['encounter', 'elite'], RunMap._stops(rng), ['boss']];
  }

  static is_fight(nodeType) {
    return RunMap.FIGHTS.includes(nodeType);
  }

  /** Fisher–Yates with the run's RNG, then keep the first 2 or 3. */
  static _stops(rng) {
    const pool = RunMap.STOP_TYPES.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.randi_range(0, i);
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
    return pool.slice(0, rng.randi_range(2, 3));
  }
}
