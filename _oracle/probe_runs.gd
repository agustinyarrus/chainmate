extends RefCounted
## Oracle probe #2 — whole runs of the ORIGINAL game logic, headless.
## The policy is the capture-tour autopilot's (scripts/presentation/autopilot.gd) with the UI stripped:
## same relic preferences, same map preferences driven by the screens already "seen", one hint on the
## first turn 2, best_move(depth 2, noise 0) for the player, `Enter` on empty follow-ups. After every
## action the full GameState.to_dict() (RNG state included) is emitted; the port replays the same
## policy and must produce identical snapshots.

const RUNS: Array = [
	["TOUR-7", "standard", "vanguard"],
	["BENCH-0", "apprentice", "cavalry"],
	["CHAINMATE", "standard", "phalanx"],
	["  ñandú-9 ", "standard", "cathedral"],
	["GRIND-42", "grandmaster", "vanguard"],
]
const STEP_LIMIT: = 4000

var _run_index: = 0
var _step: = 0


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func _snap(gs: GameState, action: String) -> void:
	_step += 1
	_emit({"k": "step", "run": _run_index, "n": _step, "action": action, "gs": gs.to_dict()})


func _cell(v: Vector2i) -> Array:
	return [v.x, v.y]


func run(_host: Node) -> void:
	for i in RUNS.size():
		_run_index = i
		_step = 0
		var spec: Array = RUNS[i]
		var started: = Time.get_ticks_msec()
		var gs: = _play(str(spec[0]), str(spec[1]), str(spec[2]))
		_emit({"k": "run_end", "run": i, "seed": spec[0], "difficulty": spec[1], "army": spec[2], "phase": gs.phase,
			"encounters_won": gs.encounters_won, "steps": _step, "ms": Time.get_ticks_msec() - started})


func _play(seed_text: String, difficulty: String, army: String) -> GameState:
	var gs: = GameState.new()
	gs.new_run({"seed": seed_text, "difficulty": difficulty, "army": army})
	_snap(gs, "new_run")
	var pilot_rng: = RandomNumberGenerator.new()
	pilot_rng.seed = 7
	var seen: = {}
	var guard: = 0
	while gs.phase != "won" and gs.phase != "lost" and guard < STEP_LIMIT:
		guard += 1
		# The level-up screen, when present, is handled first — except on a reward screen, where the game
		# only opens it after the relic choice (RewardScreen.done → _resolve_levels).
		var choosing_relic: bool = gs.phase == "reward" and not gs.reward.relic_taken
		if not gs.pending_levels.is_empty() and gs.phase != "battle" and not choosing_relic:
			var choices: = gs.current_level_choices()
			if choices.is_empty():
				gs.skip_level()
				_snap(gs, "skip_level")
			else:
				gs.choose_level(choices[0])
				_snap(gs, "choose_level %s" % choices[0])
			continue
		match gs.phase:
			"reward":
				seen["reward_%s" % str(gs.reward.kind)] = true
				if not gs.reward.relic_taken:
					var offered: Array = gs.reward.relic_choices
					var pick: = str(offered[0])
					for preferred in ["kibitzers_whisper", "desperado_ribbon", "fortress_stone"]:
						if offered.has(preferred):
							pick = preferred
					if gs.relics.size() < Relics.MAX_EQUIPPED:
						gs.take_relic(pick)
						_snap(gs, "take_relic %s" % pick)
					else:
						gs.skip_relic()
						_snap(gs, "skip_relic")
					continue
				gs.leave()
				_snap(gs, "leave reward")
			"map":
				var nodes: Array = gs.current_nodes()
				var index: = 0
				var labels: = {"merchant": "stop_merchant", "unknown": "stop_event", "rest": "stop_rest", "elite": "reward_elite"}
				for kind in labels:
					if not seen.has(labels[kind]) and nodes.has(kind):
						index = nodes.find(kind)
						break
				gs.choose_node(index)
				_snap(gs, "choose_node %d" % index)
			"merchant":
				seen["stop_merchant"] = true
				for i in gs.shop.relics.size():
					if gs.buy_relic(i):
						_snap(gs, "buy_relic %d" % i)
						break
				gs.leave()
				_snap(gs, "leave merchant")
			"rest":
				seen["stop_rest"] = true
				if not gs.rest_done:
					var moved: = gs.rest_revive(0) if not gs.fallen.is_empty() else gs.rest_train(_best_piece(gs))
					if not moved:
						moved = gs.rest_fortify()
					_snap(gs, "rest")
					continue
				gs.leave()
				_snap(gs, "leave rest")
			"event":
				seen["stop_event"] = true
				if not gs.event.resolved:
					var choices: Array = Events.info(str(gs.event.id)).choices
					for i in choices.size():
						if gs.event_choice_available(i):
							gs.event_choose(i)
							_snap(gs, "event_choose %d" % i)
							break
					continue
				gs.leave()
				_snap(gs, "leave event")
			"battle":
				_battle_step(gs, pilot_rng, seen)
	return gs


func _battle_step(gs: GameState, pilot_rng: RandomNumberGenerator, seen: Dictionary) -> void:
	var battle: = gs.battle
	if battle.outcome != "":
		gs.finish_battle()
		_snap(gs, "finish_battle")
		return
	if not battle.is_player_turn():
		var records: = gs.run_enemy_turn()
		var moves: = []
		for record in records:
			if record.has("terrain"):
				moves.append("terrain:%d" % (record.terrain as Array).size())
			else:
				moves.append("%s>%d,%d" % [record.id, record.to.x, record.to.y])
		_snap(gs, "enemy " + " ".join(moves))
		return
	if battle.turn == 2 and not seen.has("hint"):
		seen["hint"] = true
		var hinted: = gs.hint()
		_snap(gs, "hint %s" % ("-" if hinted.is_empty() else "%s>%d,%d" % [hinted.id, hinted.to.x, hinted.to.y]))
	var allowed: = battle.allowed_moves()
	if battle.in_follow_up():
		allowed = allowed.filter(func(m: Dictionary) -> bool: return not battle.board.piece_at(m.to).is_empty())
		if allowed.is_empty():
			battle.end_turn()
			_snap(gs, "end_turn follow_up")
			return
	if allowed.is_empty():
		battle.end_turn()
		_snap(gs, "end_turn pass")
		return
	var move: = Tactics.best_move(battle.board, true, 2, pilot_rng, 0.0, allowed)
	battle.move(str(move.id), move.to)
	_snap(gs, "move %s>%d,%d" % [move.id, move.to.x, move.to.y])


func _best_piece(gs: GameState) -> String:
	var best: = ""
	var best_value: = -1
	for entry in gs.army:
		if int(entry.level) < GameState.MAX_LEVEL and entry.kind != "king":
			var value: = int(ChessRules.MATERIAL[entry.kind]) * 10 + int(entry.xp)
			if value > best_value:
				best_value = value
				best = str(entry.id)
	return best
