class_name GameState
extends RefCounted







const SAVE_VERSION: = 4
const START_GOLD: = 10
const MAX_ARMY: = 8
const MAX_LEVEL: = 3
const ACT_COUNT: = 3
const XP_THRESHOLDS: Array[int] = [2, 5, 9]
const MEDAL_THRESHOLDS: Array[int] = [1, 3, 6]
const RECRUIT_PRICE: = {"pawn": 6, "knight": 11, "bishop": 11, "rook": 15, "queen": 24}
const RECRUIT_KINDS: = {"pawn": 4, "knight": 3, "bishop": 3, "rook": 2, "queen": 1}
const TRAIN_PRICE: = 12
const MEND_PRICE: = 10

const ARMIES: = {
	"vanguard": {"name": "Classical", "kinds": ["king", "rook", "knight", "bishop", "pawn", "pawn"], 
		"desc": "A balanced company around the king."}, 
	"cavalry": {"name": "Hussars", "kinds": ["king", "knight", "knight", "pawn", "pawn", "pawn"], 
		"desc": "Two knights screened by three pawns."}, 
	"cathedral": {"name": "Bishop Pair", "kinds": ["king", "bishop", "bishop", "rook", "pawn", "pawn"], 
		"desc": "Twin bishops and a rook."}, 
	"phalanx": {"name": "Pawn Chain", "kinds": ["king", "rook", "pawn", "pawn", "pawn", "pawn"], 
		"desc": "A wall of pawns. Built for promotion."}, 
}

const DIFFICULTIES: = {
	"apprentice": {"name": "Coffeehouse", "ai_depth": 1, "ai_noise": 140.0, "budget_scale": 0.8, "gold_scale": 1.25, "hints": -1, 
		"desc": "A forgiving opponent, smaller armies, unlimited hints."}, 
	"standard": {"name": "Tournament", "ai_depth": 2, "ai_noise": 12.0, "budget_scale": 1.0, "gold_scale": 1.0, "hints": 3, 
		"desc": "The intended challenge. Three hints per run."}, 
	"grandmaster": {"name": "Grandmaster", "ai_depth": 3, "ai_noise": 0.0, "budget_scale": 1.45, "gold_scale": 0.8, "hints": 0, 
		"desc": "A sharper opponent, larger armies, no hints."}, 
}

const SAVE_KEYS: Array[String] = [
	"version", "seed_text", "difficulty", "army_preset", "rng_seed", "rng_state", "phase", "act", "step", 
	"map", "path", "node_type", "gold", "relics", "army", "fallen", "battle", "fortified", "phoenix_act", 
	"hints_left", "encounters_won", "stats", "pending_levels", "reward", "shop", "event", "rest_done", 
	"seen_events", "next_army_id", 
]

var seed_text: = ""
var difficulty: = "standard"
var army_preset: = "vanguard"
var rng: = RandomNumberGenerator.new()

var phase: = "reward"
var act: = 0
var step: = 0
var map: Array = []
var path: Array[int] = []
var node_type: = ""
var gold: = START_GOLD
var relics: Array[String] = []
var army: Array[Dictionary] = []
var fallen: Array[Dictionary] = []
var battle: Battle = null
var fortified: = false
var phoenix_act: = -1
var hints_left: = 3
var encounters_won: = 0
var stats: Dictionary = {}

var pending_levels: Array[Dictionary] = []
var reward: Dictionary = {}
var shop: Dictionary = {}
var event: Dictionary = {}
var rest_done: = false
var seen_events: Array[String] = []
var _next_army_id: = 0





func new_run(config: = {}) -> void :
	seed_text = str(config.get("seed", "")).strip_edges().to_upper()
	if seed_text == "":
		seed_text = random_seed_text()
	difficulty = str(config.get("difficulty", "standard"))
	army_preset = str(config.get("army", "vanguard"))
	assert (DIFFICULTIES.has(difficulty), "unknown difficulty '%s'" % difficulty)
	assert (ARMIES.has(army_preset), "unknown army '%s'" % army_preset)
	rng = RandomNumberGenerator.new()
	rng.seed = hash(seed_text)
	act = 0
	step = 0
	path.clear()
	gold = START_GOLD
	relics.clear()
	army.clear()
	fallen.clear()
	pending_levels.clear()
	seen_events.clear()
	battle = null
	fortified = false
	phoenix_act = -1
	encounters_won = 0
	hints_left = int(DIFFICULTIES[difficulty].hints)
	stats = _fresh_stats()
	_next_army_id = 0
	for kind in ARMIES[army_preset].kinds:
		_add_to_army(str(kind))
	map = RunMap.generate(rng)
	node_type = ""
	shop = {}
	event = {}
	rest_done = false
	reward = {"kind": "opening", "gold": 0, "lines": [], "relic_choices": _relic_choices(3), "relic_taken": false, "revived": ""}
	phase = "reward"


static func random_seed_text() -> String:
	const ALPHABET: = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var generator: = RandomNumberGenerator.new()
	generator.randomize()
	var text: = ""
	for i in 8:
		if i == 4:
			text += "-"
		text += ALPHABET[generator.randi_range(0, ALPHABET.length() - 1)]
	return text


func act_info() -> Dictionary:
	return Encounters.ACTS[act]



func encounter_number() -> int:
	return encounters_won + (1 if phase == "battle" else 0)


func total_encounters() -> int:
	return ACT_COUNT * 3


func current_nodes() -> Array:
	return map[step]




func choose_node(index: int) -> bool:
	if phase != "map" or index < 0 or index >= map[step].size():
		return false
	node_type = str(map[step][index])
	path.append(index)
	if RunMap.is_fight(node_type):
		battle = Encounters.build(self, node_type)
		fortified = false
		phase = "battle"
	elif node_type == "merchant":
		shop = _roll_shop()
		phase = "merchant"
	elif node_type == "rest":
		rest_done = false
		phase = "rest"
	else:
		event = {"id": _pick_event(), "resolved": false, "outcome": ""}
		phase = "event"
	return true




func ai_depth() -> int:
	return int(DIFFICULTIES[difficulty].ai_depth)


func run_enemy_turn() -> Array[Dictionary]:
	return battle.enemy_turn(ai_depth(), rng, float(DIFFICULTIES[difficulty].ai_noise))



func hint() -> Dictionary:
	if phase != "battle" or not battle.is_player_turn() or hints_left == 0:
		return {}
	var allowed: = battle.allowed_moves()
	if allowed.is_empty():
		return {}
	var move: = Tactics.best_move(battle.board, true, 2, rng, 0.0, allowed)
	if move.is_empty():
		return {}
	if hints_left > 0:
		hints_left -= 1
	return move



func finish_battle() -> Dictionary:
	if phase != "battle" or battle.outcome == "":
		return {}
	stats.turns = int(stats.turns) + battle.turn
	stats.captures = int(stats.captures) + battle.captures
	stats.best_chain = maxi(int(stats.best_chain), battle.best_chain)
	stats.pieces_lost = int(stats.pieces_lost) + battle.lost.size()
	if battle.outcome == "lost":
		phase = "lost"
		return {}
	var lost_ids: = []
	for piece in battle.lost:
		lost_ids.append(piece.id)
	var survivors: Array[Dictionary] = []
	var newly_fallen: Array[Dictionary] = []
	for entry in army:
		if lost_ids.has(entry.id):
			newly_fallen.append(entry)
		else:
			survivors.append(entry)
	army = survivors
	fallen.append_array(newly_fallen)
	for entry in army:
		if battle.promoted.has(entry.id):
			entry.kind = "queen"
			entry.upgrades = Upgrades.carried_over(entry.upgrades, "queen")
			stats.promotions = int(stats.promotions) + 1
		_grant_xp(entry, int(battle.xp_gained[entry.id]))
	var revived: = ""
	if relics.has("sealed_move") and phoenix_act != act and not newly_fallen.is_empty():
		var returning: Dictionary = newly_fallen[0]
		fallen.erase(returning)
		army.append(returning)
		phoenix_act = act
		revived = str(returning.kind)

	var lines: = []
	var base: = 10 + 3 * act
	lines.append(["Victory", base])
	if node_type == "elite":
		lines.append(["Elite bounty", base / 2])
	if node_type == "boss":
		lines.append(["Boss bounty", 15])
	if battle.lost.is_empty():
		lines.append(["Flawless", 5])
	if battle.swift():
		lines.append(["Swift", 3])
	if relics.has("appearance_fee"):
		lines.append(["Appearance Fee", 2])
	if battle.gold_found > 0:
		lines.append(["Ransom", battle.gold_found])
	var total: = 0
	for line in lines:
		total += int(line[1])
	total = int(round(total * float(DIFFICULTIES[difficulty].gold_scale)))
	gold += total
	stats.gold_earned = int(stats.gold_earned) + total
	encounters_won += 1
	var choices: Array[String] = []
	if node_type == "elite" or node_type == "boss":
		choices = _relic_choices(3)
	reward = {"kind": node_type, "gold": total, "lines": lines, "relic_choices": choices, "relic_taken": choices.is_empty(), "revived": revived}
	battle = null
	phase = "won" if node_type == "boss" and act == ACT_COUNT - 1 else "reward"
	return reward




func army_entry(id: String) -> Dictionary:
	for entry in army:
		if entry.id == id:
			return entry
	return {}


func level_thresholds() -> Array[int]:
	return MEDAL_THRESHOLDS if relics.has("grandmaster_norm") else XP_THRESHOLDS



func next_threshold(entry: Dictionary) -> int:
	return -1 if int(entry.level) >= MAX_LEVEL else level_thresholds()[int(entry.level)]




func current_level_choices() -> Array[String]:
	if pending_levels.is_empty():
		return []
	var pending: Dictionary = pending_levels[0]
	var entry: = army_entry(str(pending.id))
	var available: = Upgrades.pool_for(str(entry.kind), entry.upgrades)
	var valid: Array[String] = []
	for id in pending.choices:
		if available.has(id):
			valid.append(id)
	if valid.is_empty() and not available.is_empty():
		valid = _level_choices(entry)
		pending.choices = valid
	return valid


func choose_level(upgrade_id: String) -> bool:
	if not current_level_choices().has(upgrade_id):
		return false
	var entry: = army_entry(str(pending_levels[0].id))
	entry.upgrades.append(upgrade_id)
	pending_levels.pop_front()
	return true



func skip_level() -> bool:
	if pending_levels.is_empty() or not current_level_choices().is_empty():
		return false
	pending_levels.pop_front()
	return true


func take_relic(id: String) -> bool:
	if phase != "reward" or reward.relic_taken or not reward.relic_choices.has(id) or relics.size() >= Relics.MAX_EQUIPPED:
		return false
	relics.append(id)
	reward.relic_taken = true
	return true



func swap_relic(old_id: String, new_id: String) -> bool:
	if phase != "reward" or reward.relic_taken or not reward.relic_choices.has(new_id) or not relics.has(old_id):
		return false
	relics[relics.find(old_id)] = new_id
	reward.relic_taken = true
	return true


func skip_relic() -> void :
	if phase == "reward":
		reward.relic_taken = true


func can_leave() -> bool:
	if not pending_levels.is_empty():
		return false
	match phase:
		"reward":
			return reward.relic_taken
		"event":
			return event.resolved
		"merchant", "rest":
			return true
	return false



func leave() -> bool:
	if not can_leave():
		return false
	var opening: = phase == "reward" and str(reward.kind) == "opening"
	if not opening:
		step += 1
		if step >= RunMap.STEPS:
			act += 1
			step = 0
			path.clear()
			map = RunMap.generate(rng)
	reward = {}
	shop = {}
	event = {}
	phase = "map"
	return true




func discounted() -> bool:
	return relics.has("patrons_chit")


func shop_relic_price(index: int) -> int:
	return Relics.price(str(shop.relics[index]), discounted())


func recruit_price(kind: String) -> int:
	var base: int = RECRUIT_PRICE[kind]
	return int(ceil(base * 0.75)) if discounted() else base


func service_price(base: int) -> int:
	return int(ceil(base * 0.75)) if discounted() else base


func buy_relic(index: int) -> bool:
	if phase != "merchant" or index < 0 or index >= shop.relics.size() or str(shop.relics[index]) == "":
		return false
	var id: = str(shop.relics[index])
	var price: = shop_relic_price(index)
	if gold < price or relics.size() >= Relics.MAX_EQUIPPED or relics.has(id):
		return false
	gold -= price
	relics.append(id)
	shop.relics[index] = ""
	return true


func buy_recruit(index: int) -> bool:
	if phase != "merchant" or index < 0 or index >= shop.recruits.size() or str(shop.recruits[index]) == "":
		return false
	var kind: = str(shop.recruits[index])
	var price: = recruit_price(kind)
	if gold < price or army.size() >= MAX_ARMY:
		return false
	gold -= price
	_add_to_army(kind)
	shop.recruits[index] = ""
	return true


func train(id: String) -> bool:
	var entry: = army_entry(id)
	var price: = service_price(TRAIN_PRICE)
	if phase != "merchant" or entry.is_empty() or int(entry.level) >= MAX_LEVEL or gold < price or not pending_levels.is_empty():
		return false
	gold -= price
	_level_up(entry)
	return true


func mend(index: int) -> bool:
	var price: = service_price(MEND_PRICE)
	if phase != "merchant" or index < 0 or index >= fallen.size() or gold < price or army.size() >= MAX_ARMY:
		return false
	gold -= price
	army.append(fallen[index])
	fallen.remove_at(index)
	return true




func rest_revive(index: int) -> bool:
	if phase != "rest" or rest_done or index < 0 or index >= fallen.size() or army.size() >= MAX_ARMY:
		return false
	army.append(fallen[index])
	fallen.remove_at(index)
	rest_done = true
	return true


func rest_train(id: String) -> bool:
	var entry: = army_entry(id)
	if phase != "rest" or rest_done or entry.is_empty() or int(entry.level) >= MAX_LEVEL:
		return false
	_level_up(entry)
	rest_done = true
	return true


func rest_fortify() -> bool:
	if phase != "rest" or rest_done:
		return false
	fortified = true
	rest_done = true
	return true




func event_choice_available(index: int) -> bool:
	var choices: Array = Events.info(str(event.id)).choices
	if phase != "event" or event.resolved or index < 0 or index >= choices.size():
		return false
	var choice: Dictionary = choices[index]
	match str(choice.requires):
		"pawn":
			return _army_has("pawn")
		"fallen":
			return not fallen.is_empty() and army.size() < MAX_ARMY
		"gold":
			return gold >= int(choice.cost)
	if str(choice.effect) == "recruit":
		return army.size() < MAX_ARMY
	return true



func event_choose(index: int) -> String:
	if not event_choice_available(index):
		return ""
	var choice: Dictionary = Events.info(str(event.id)).choices[index]
	var outcome: = ""
	match str(choice.effect):
		"gold":
			gold += int(choice.amount)
			outcome = "You gain %d gold." % int(choice.amount)
		"train_random":
			var candidates: = _trainable()
			if candidates.is_empty():
				gold += 10
				outcome = "Every piece is already a master. You sell the blade for 10 gold."
			else:
				var entry: Dictionary = candidates[rng.randi_range(0, candidates.size() - 1)]
				_level_up(entry)
				outcome = "Your %s grows stronger." % str(entry.kind)
		"recruit":
			gold -= int(choice.cost)
			_add_to_army(str(choice.kind))
			outcome = "A %s joins your army." % str(choice.kind)
		"sacrifice_pawn":
			var pawns: Array[Dictionary] = []
			for entry in army:
				if entry.kind == "pawn":
					pawns.append(entry)
			pawns.sort_custom( func(a: Dictionary, b: Dictionary) -> bool: return int(a.level) < int(b.level))
			army.erase(pawns[0])
			var raised: = 0
			for _i in 2:
				var candidates: = _trainable()
				if candidates.is_empty():
					break
				_level_up(candidates[rng.randi_range(0, candidates.size() - 1)])
				raised += 1
			outcome = "The pawn is gone. %d of your pieces feel its strength." % raised
		"fortify":
			fortified = true
			outcome = "Your army will be warded in the next encounter."
		"revive":
			var returning: Dictionary = fallen.pop_back()
			army.append(returning)
			outcome = "Your %s returns to the ranks." % str(returning.kind)
		"xp_all":
			for entry in army:
				_grant_xp(entry, int(choice.amount))
			outcome = "Every piece gains %d XP." % int(choice.amount)
		"relic_random":
			var offered: = _relic_choices(1)
			if offered.is_empty() or relics.size() >= Relics.MAX_EQUIPPED:
				gold += 12
				outcome = "Nothing you can carry. You sell the tome for 12 gold."
			else:
				relics.append(offered[0])
				outcome = "You gain %s." % Relics.display_name(offered[0])
		"gamble":
			gold -= int(choice.cost)
			if rng.randf() < 0.5:
				gold += int(choice.win)
				outcome = "The dice favour you: %d gold." % int(choice.win)
			else:
				outcome = "The house wins."
		"none":
			outcome = "You move on."
	event.resolved = true
	event.outcome = outcome
	return outcome




func to_dict() -> Dictionary:
	return {
		"version": SAVE_VERSION, 
		"seed_text": seed_text, 
		"difficulty": difficulty, 
		"army_preset": army_preset, 
		"rng_seed": str(rng.seed), 
		"rng_state": str(rng.state), 
		"phase": phase, 
		"act": act, 
		"step": step, 
		"map": map.duplicate(true), 
		"path": Array(path), 
		"node_type": node_type, 
		"gold": gold, 
		"relics": Array(relics), 
		"army": _entries_data(army), 
		"fallen": _entries_data(fallen), 
		"battle": battle.to_dict() if battle != null else {}, 
		"fortified": fortified, 
		"phoenix_act": phoenix_act, 
		"hints_left": hints_left, 
		"encounters_won": encounters_won, 
		"stats": stats.duplicate(), 
		"pending_levels": _pending_data(), 
		"reward": reward.duplicate(true), 
		"shop": shop.duplicate(true), 
		"event": event.duplicate(true), 
		"rest_done": rest_done, 
		"seen_events": Array(seen_events), 
		"next_army_id": _next_army_id, 
	}



static func from_dict(data: Variant) -> GameState:
	if typeof(data) != TYPE_DICTIONARY or int(data.get("version", -1)) != SAVE_VERSION:
		return null
	for key in SAVE_KEYS:
		if not data.has(key):
			return null
	var gs: = GameState.new()
	gs.seed_text = str(data.seed_text)
	gs.difficulty = str(data.difficulty)
	gs.army_preset = str(data.army_preset)
	gs.phase = str(data.phase)
	if not DIFFICULTIES.has(gs.difficulty) or not ARMIES.has(gs.army_preset):
		return null
	if not ["reward", "map", "battle", "merchant", "rest", "event", "won", "lost"].has(gs.phase):
		return null
	gs.act = int(data.act)
	gs.step = int(data.step)
	if gs.act < 0 or gs.act >= ACT_COUNT or gs.step < 0 or gs.step >= RunMap.STEPS:
		return null
	if typeof(data.map) != TYPE_ARRAY or data.map.size() != RunMap.STEPS:
		return null
	for column in data.map:
		if typeof(column) != TYPE_ARRAY or column.is_empty():
			return null
		for node in column:
			if not RunMap.NODE_INFO.has(str(node)):
				return null
	for key in ["path", "relics", "army", "fallen", "pending_levels", "seen_events"]:
		if typeof(data[key]) != TYPE_ARRAY:
			return null
	for key in ["battle", "stats", "reward", "shop", "event"]:
		if typeof(data[key]) != TYPE_DICTIONARY:
			return null
	gs.map = data.map.duplicate(true)
	for index in data.path:
		gs.path.append(int(index))
	gs.node_type = str(data.node_type)
	gs.gold = int(data.gold)
	for id in data.relics:
		if not Relics.exists(str(id)):
			return null
		gs.relics.append(str(id))
	var restored_army: Variant = _entries_from(data.army)
	var restored_fallen: Variant = _entries_from(data.fallen)
	if restored_army == null or restored_fallen == null or restored_army.is_empty():
		return null
	gs.army.assign(restored_army)
	gs.fallen.assign(restored_fallen)
	if gs.phase == "battle":
		gs.battle = Battle.from_dict(data.battle)
		if gs.battle == null:
			return null
	gs.fortified = bool(data.fortified)
	gs.phoenix_act = int(data.phoenix_act)
	gs.hints_left = int(data.hints_left)
	gs.encounters_won = int(data.encounters_won)
	if typeof(data.stats) != TYPE_DICTIONARY:
		return null
	gs.stats = _fresh_stats()
	for key in gs.stats:
		if not data.stats.has(key):
			return null
		gs.stats[key] = int(data.stats[key])
	for pending in data.pending_levels:
		if typeof(pending) != TYPE_DICTIONARY or not pending.has("id") or not pending.has("choices"):
			return null
		var choices: Array[String] = []
		for id in pending.choices:
			if not Upgrades.exists(str(id)):
				return null
			choices.append(str(id))
		gs.pending_levels.append({"id": str(pending.id), "choices": choices})
	gs.reward = _normalised(data.reward)
	gs.shop = _normalised(data.shop)
	gs.event = _normalised(data.event)
	if gs.phase == "reward" and not _has_keys(gs.reward, ["kind", "gold", "lines", "relic_choices", "relic_taken", "revived"]):
		return null
	if gs.phase == "merchant" and not _has_keys(gs.shop, ["relics", "recruits"]):
		return null
	if gs.phase == "event" and ( not _has_keys(gs.event, ["id", "resolved", "outcome"]) or not Events.CATALOGUE.has(str(gs.event.id))):
		return null
	var offered: = []
	if gs.phase == "reward":
		offered.append_array(gs.reward.relic_choices)
	if gs.phase == "merchant":
		offered.append_array(gs.shop.relics)
	for id in offered:
		if str(id) != "" and not Relics.exists(str(id)):
			return null
	gs.rest_done = bool(data.rest_done)
	for id in data.seen_events:
		gs.seen_events.append(str(id))
	gs._next_army_id = int(data.next_army_id)
	gs.rng.seed = str(data.rng_seed).to_int()
	gs.rng.state = str(data.rng_state).to_int()
	return gs




static func _has_keys(value: Dictionary, keys: Array) -> bool:
	for key in keys:
		if not value.has(key):
			return false
	return true


static func _fresh_stats() -> Dictionary:
	return {"captures": 0, "pieces_lost": 0, "best_chain": 0, "turns": 0, "gold_earned": 0, "promotions": 0}


func _add_to_army(kind: String) -> void :
	army.append({"id": "a%d" % _next_army_id, "kind": kind, "xp": 0, "level": 0, "upgrades": []})
	_next_army_id += 1


func _army_has(kind: String) -> bool:
	for entry in army:
		if entry.kind == kind:
			return true
	return false


func _trainable() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for entry in army:
		if int(entry.level) < MAX_LEVEL:
			out.append(entry)
	return out


func _grant_xp(entry: Dictionary, amount: int) -> void :
	entry.xp = int(entry.xp) + amount
	var thresholds: = level_thresholds()
	while int(entry.level) < MAX_LEVEL and int(entry.xp) >= thresholds[int(entry.level)]:
		entry.level = int(entry.level) + 1
		pending_levels.append({"id": entry.id, "choices": _level_choices(entry)})



func _level_up(entry: Dictionary) -> void :
	entry.xp = maxi(int(entry.xp), level_thresholds()[int(entry.level)])
	entry.level = int(entry.level) + 1
	pending_levels.append({"id": entry.id, "choices": _level_choices(entry)})


func _level_choices(entry: Dictionary) -> Array[String]:
	var pool: = Upgrades.pool_for(str(entry.kind), entry.upgrades)
	for i in range(pool.size() - 1, 0, -1):
		var j: = rng.randi_range(0, i)
		var swap: = pool[i]
		pool[i] = pool[j]
		pool[j] = swap
	var count: = 4 if relics.has("annotators_quill") else 3
	var choices: Array[String] = []
	for id in pool:
		if choices.size() < count:
			choices.append(id)
	return choices


func _relic_choices(count: int) -> Array[String]:
	var pool: Array[String] = []
	for id in Relics.CATALOGUE:
		if not relics.has(id):
			pool.append(id)
	var out: Array[String] = []
	while out.size() < count and not pool.is_empty():
		var total: = 0
		for id in pool:
			total += int(Relics.RARITY_WEIGHT[Relics.info(id).rarity])
		var roll: = rng.randi_range(1, total)
		for id in pool:
			roll -= int(Relics.RARITY_WEIGHT[Relics.info(id).rarity])
			if roll <= 0:
				out.append(id)
				pool.erase(id)
				break
	return out


func _roll_shop() -> Dictionary:
	var recruits: = []
	for _i in 2:
		var total: = 0
		for kind in RECRUIT_KINDS:
			total += int(RECRUIT_KINDS[kind])
		var roll: = rng.randi_range(1, total)
		for kind in RECRUIT_KINDS:
			roll -= int(RECRUIT_KINDS[kind])
			if roll <= 0:
				recruits.append(kind)
				break
	return {"relics": Array(_relic_choices(3)), "recruits": recruits}


func _pick_event() -> String:
	var pool: Array[String] = []
	for id in Events.ids():
		if not seen_events.has(id):
			pool.append(id)
	if pool.is_empty():
		seen_events.clear()
		pool = Events.ids()
	var id: = pool[rng.randi_range(0, pool.size() - 1)]
	seen_events.append(id)
	return id


func _pending_data() -> Array:
	var out: = []
	for pending in pending_levels:
		out.append({"id": pending.id, "choices": Array(pending.choices)})
	return out


static func _entries_data(entries: Array[Dictionary]) -> Array:
	var out: = []
	for entry in entries:
		out.append({"id": entry.id, "kind": entry.kind, "xp": entry.xp, "level": entry.level, "upgrades": Array(entry.upgrades)})
	return out


static func _entries_from(data: Variant) -> Variant:
	if typeof(data) != TYPE_ARRAY:
		return null
	var out: Array[Dictionary] = []
	for entry in data:
		if typeof(entry) != TYPE_DICTIONARY:
			return null
		for key in ["id", "kind", "xp", "level", "upgrades"]:
			if not entry.has(key):
				return null
		if not ChessRules.KINDS.has(str(entry.kind)) or int(entry.level) < 0 or int(entry.level) > MAX_LEVEL:
			return null
		var upgrades: = []
		for id in entry.upgrades:
			if not Upgrades.exists(str(id)):
				return null
			upgrades.append(str(id))
		out.append({"id": str(entry.id), "kind": str(entry.kind), "xp": int(entry.xp), "level": int(entry.level), "upgrades": upgrades})
	return out



static func _normalised(value: Variant) -> Variant:
	match typeof(value):
		TYPE_FLOAT:
			return int(value)
		TYPE_ARRAY:
			var items: = []
			for item in value:
				items.append(_normalised(item))
			return items
		TYPE_DICTIONARY:
			var entries: = {}
			for key in value:
				entries[key] = _normalised(value[key])
			return entries
	return value
