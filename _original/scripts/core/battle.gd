class_name Battle
extends RefCounted




const TURN_LIMIT: = 40

const LIMIT_WARNING: = 10

const ROUT_RATIO: = 4
const CHAIN_MAX: = 2
const CAPTURE_XP: = 1
const ROYAL_XP: = 2
const SWIFT_TURNS: = 12

var board: = Board.new()
var turn: = 1
var side: = "player"
var outcome: = ""
var reason: = ""
var objective: = "eliminate"
var boss_rule: = ""
var relics: Array[String] = []
var fortress: = 0
var clock_key_ready: = false
var extra_turn_pending: = false


var active_id: = ""
var bonus_captures: = 0
var bonus_moves: = 0
var bonus_quiet: = 0
var turn_captures: = 0
var chain_granted: = false
var relic_follow_used: = false
var momentum_used: = false
var charge_used: = false


var xp_gained: Dictionary = {}
var lost: Array[Dictionary] = []
var promoted: Array[String] = []
var captures: = 0
var best_chain: = 0
var gold_found: = 0


static func create(start: Board, run_relics: Array[String], goal: String, rule: String) -> Battle:
	var battle: = Battle.new()
	battle.board = start
	battle.relics.assign(run_relics)
	battle.objective = goal
	battle.boss_rule = rule
	battle.fortress = 1 if run_relics.has("fortress_stone") else 0
	battle.clock_key_ready = run_relics.has("clockmakers_key")
	battle.extra_turn_pending = run_relics.has("opening_book")
	for piece in start.friendlies():
		battle.xp_gained[piece.id] = 0
	return battle




func is_player_turn() -> bool:
	return outcome == "" and side == "player"


func in_follow_up() -> bool:
	return active_id != ""



func moves_for(id: String) -> Array[Vector2i]:
	if not is_player_turn() or not board.has_piece(id):
		return []
	var piece: = board.piece_by_id(id)
	if not piece.friendly:
		return []
	if active_id != "" and id != active_id:
		return []
	var captures_allowed: = active_id == "" or bonus_captures > 0 or bonus_moves > 0
	var quiet_allowed: = active_id == "" or bonus_quiet > 0 or bonus_moves > 0
	if not captures_allowed and not quiet_allowed:
		return []
	var moves: = ChessRules.legal_moves(board, piece, quiet_allowed, captures_allowed)
	if relics.has("salt_horn"):
		return moves

	var safe: Array[Vector2i] = []
	for cell in moves:
		if board.tile(cell) != "corrupted" or not _consumed_exposes_king(id, cell):
			safe.append(cell)
	return safe



func allowed_moves() -> Array:
	var out: = []
	for piece in board.friendlies():
		for cell in moves_for(piece.id):
			out.append({"id": piece.id, "to": cell})
	return out


func movable_ids() -> Array[String]:
	var out: Array[String] = []
	for piece in board.friendlies():
		if not moves_for(piece.id).is_empty():
			out.append(piece.id)
	return out


func player_in_check() -> bool:
	return ChessRules.in_check(board, true)



func threatened_ids() -> Array[String]:
	var out: Array[String] = []
	for piece in board.friendlies():
		if ChessRules.is_attacked(board, piece.cell, false):
			out.append(piece.id)
	return out



func enemy_attack_cells() -> Array[Vector2i]:
	var seen: = {}
	var out: Array[Vector2i] = []
	for piece in board.enemies():
		for cell in ChessRules.attack_cells(board, piece):
			if not seen.has(cell):
				seen[cell] = true
				out.append(cell)
	return out



func material(friendly: bool) -> int:
	var total: = 0
	for piece in board.side(friendly):
		total += int(ChessRules.MATERIAL[piece.kind])
	return total


func enemy_moves_twice() -> bool:
	return boss_rule == "double_move" and turn % 3 == 0


func swift() -> bool:
	return turn <= SWIFT_TURNS






func move(id: String, to: Vector2i) -> Dictionary:
	if not moves_for(id).has(to):
		return {}
	var piece: = board.piece_by_id(id)
	var follow_up: = active_id != ""
	var capturing: = not board.piece_at(to).is_empty()
	if follow_up:
		if capturing:
			if bonus_captures > 0:
				bonus_captures -= 1
			else:
				bonus_moves -= 1
		elif bonus_quiet > 0:
			bonus_quiet -= 1
		else:
			bonus_moves -= 1
	var record: = ChessRules.perform(board, id, to)
	active_id = id
	record.follow_up = follow_up
	record.xp = 0
	record.gold = 0
	record.corrupted = Vector2i(-1, -1)
	record.turn_end = {}
	if not record.captured.is_empty():
		captures += 1
		turn_captures += 1
		best_chain = maxi(best_chain, turn_captures)
		var xp: = ROYAL_XP if ChessRules.ROYAL.has(record.captured.kind) else CAPTURE_XP
		if piece.upgrades.has("veteran"):
			xp += 1
		if relics.has("brilliancy_prize"):
			xp += 1
		xp_gained[id] = int(xp_gained[id]) + xp
		record.xp = xp
		if relics.has("ransom_ledger") and ChessRules.ROYAL.has(record.captured.kind):
			gold_found += 5
			record.gold = 5
		if boss_rule == "corrupting_pawns" and record.captured.kind == "pawn":
			board.set_tile(record.from, "corrupted")
			record.corrupted = record.from
		if not chain_granted:
			chain_granted = true
			bonus_captures += mini(piece.upgrades.count("chain"), CHAIN_MAX)
		if relics.has("desperado_ribbon") and not relic_follow_used:
			relic_follow_used = true
			bonus_moves += 1
		if piece.upgrades.has("charge") and not charge_used:
			charge_used = true
			bonus_quiet += 1
	elif not record.bounced and piece.upgrades.has("momentum") and not momentum_used:
		momentum_used = true
		bonus_moves += 1
	if record.promoted:
		promoted.append(id)
	_check_victory()
	if outcome != "" or moves_for(id).is_empty():
		record.turn_end = _end_player_turn()
	record.outcome = outcome
	return record



func end_turn() -> Dictionary:
	if not is_player_turn():
		return {}
	return _end_player_turn()


func use_clock_key() -> bool:
	if not is_player_turn() or not clock_key_ready:
		return false
	clock_key_ready = false
	extra_turn_pending = true
	return true






func enemy_turn(depth: int, rng: RandomNumberGenerator, noise: float) -> Array[Dictionary]:
	var records: Array[Dictionary] = []
	if outcome != "" or side != "enemy":
		return records
	var count: = 2 if enemy_moves_twice() else 1
	for i in count:
		if board.enemies().is_empty():
			break
		if not ChessRules.has_legal_move(board, false):
			break


		var allowed: = []
		if i > 0:
			for piece in board.enemies():
				for cell in ChessRules.legal_moves(board, piece):
					var occupant: = board.piece_at(cell)
					if occupant.is_empty() or occupant.kind != "king":
						allowed.append({"id": piece.id, "to": cell})
			if allowed.is_empty():
				break
		var choice: = Tactics.best_move(board, false, depth, rng, noise, allowed)
		var target: = board.piece_at(choice.to)
		var shielded: bool = fortress > 0 and not target.is_empty() and target.friendly and int(target.ward) <= 0
		var record: = ChessRules.perform(board, choice.id, choice.to, shielded)
		if record.shielded:
			fortress -= 1
		if not record.captured.is_empty():
			lost.append(record.captured)
			if record.captured.kind == "king":
				outcome = "lost"
				reason = "king"
		records.append(record)
		if outcome != "":
			break
	var destroyed: = _resolve_corruption(false)
	records.append({"terrain": destroyed})
	_check_victory()
	if outcome == "":
		turn += 1
		side = "player"
		if turn > TURN_LIMIT:

			var ahead: = material(true) > material(false)
			outcome = "won" if ahead else "lost"
			reason = "withdrew" if ahead else "exhausted"
		elif ChessRules.in_check(board, true) and not ChessRules.has_legal_move(board, true):
			outcome = "lost"
			reason = "checkmate"
	return records




func _consumed_exposes_king(id: String, cell: Vector2i) -> bool:
	var record: = ChessRules.perform(board, id, cell)
	var index: = board.index_of(id)
	var mover: = board.remove(id)
	var exposed: = ChessRules.in_check(board, true)
	board.insert(mover, index)
	ChessRules.revert(board, record)
	return exposed


func _end_player_turn() -> Dictionary:
	var record: = {"destroyed": [], "extra_turn": false}
	if not relics.has("salt_horn"):
		record.destroyed = _resolve_corruption(true)
	_reset_turn()
	_check_victory()
	if outcome != "":
		return record
	if extra_turn_pending:
		extra_turn_pending = false
		record.extra_turn = true
		return record
	side = "enemy"
	return record


func _reset_turn() -> void :
	active_id = ""
	bonus_captures = 0
	bonus_moves = 0
	bonus_quiet = 0
	turn_captures = 0
	chain_granted = false
	relic_follow_used = false
	momentum_used = false
	charge_used = false



func _resolve_corruption(friendly: bool) -> Array:
	var destroyed: = []
	for piece in board.side(friendly):
		if board.tile(piece.cell) == "corrupted":
			destroyed.append(piece.duplicate(true))
	for piece in destroyed:
		board.remove(piece.id)
		if friendly:
			lost.append(piece)
	return destroyed


func _check_victory() -> void :
	if outcome != "":
		return
	if board.enemies().is_empty():
		outcome = "won"
		reason = "eliminated"
	elif objective == "regicide" and board.king(false).is_empty():
		outcome = "won"
		reason = "regicide"
	elif objective == "eliminate" and board.enemies().size() == 1 and material(false) * ROUT_RATIO <= material(true):

		outcome = "won"
		reason = "routed"




func to_dict() -> Dictionary:
	var lost_data: = []
	for piece in lost:
		var entry: Dictionary = piece.duplicate(true)
		entry.cell = [piece.cell.x, piece.cell.y]
		entry.upgrades = Array(piece.upgrades)
		lost_data.append(entry)
	return {
		"board": board.to_data(), "turn": turn, "side": side, "outcome": outcome, "reason": reason, 
		"objective": objective, "boss_rule": boss_rule, "relics": Array(relics), "fortress": fortress, 
		"clock_key_ready": clock_key_ready, "extra_turn_pending": extra_turn_pending, 
		"active_id": active_id, "bonus_captures": bonus_captures, "bonus_moves": bonus_moves, 
		"bonus_quiet": bonus_quiet, "turn_captures": turn_captures, "chain_granted": chain_granted, 
		"relic_follow_used": relic_follow_used, "momentum_used": momentum_used, "charge_used": charge_used, 
		"xp_gained": xp_gained.duplicate(), "lost": lost_data, "promoted": Array(promoted), 
		"captures": captures, "best_chain": best_chain, "gold_found": gold_found, 
	}


const SAVE_KEYS: Array[String] = [
	"board", "turn", "side", "outcome", "reason", "objective", "boss_rule", "relics", "fortress", 
	"clock_key_ready", "extra_turn_pending", "active_id", "bonus_captures", "bonus_moves", "bonus_quiet", 
	"turn_captures", "chain_granted", "relic_follow_used", "momentum_used", "charge_used", "xp_gained", 
	"lost", "promoted", "captures", "best_chain", "gold_found", 
]


static func from_dict(data: Variant) -> Battle:
	if typeof(data) != TYPE_DICTIONARY:
		return null
	for key in SAVE_KEYS:
		if not data.has(key):
			return null
	var restored: = Board.from_data(data.board)
	if restored == null or not ["player", "enemy"].has(str(data.side)):
		return null
	var battle: = Battle.new()
	battle.board = restored
	battle.turn = int(data.turn)
	battle.side = str(data.side)
	battle.outcome = str(data.outcome)
	battle.reason = str(data.reason)
	battle.objective = str(data.objective)
	battle.boss_rule = str(data.boss_rule)
	for id in data.relics:
		if not Relics.exists(str(id)):
			return null
		battle.relics.append(str(id))
	battle.fortress = int(data.fortress)
	battle.clock_key_ready = bool(data.clock_key_ready)
	battle.extra_turn_pending = bool(data.extra_turn_pending)
	battle.active_id = str(data.active_id)
	battle.bonus_captures = int(data.bonus_captures)
	battle.bonus_moves = int(data.bonus_moves)
	battle.bonus_quiet = int(data.bonus_quiet)
	battle.turn_captures = int(data.turn_captures)
	battle.chain_granted = bool(data.chain_granted)
	battle.relic_follow_used = bool(data.relic_follow_used)
	battle.momentum_used = bool(data.momentum_used)
	battle.charge_used = bool(data.charge_used)
	if typeof(data.xp_gained) != TYPE_DICTIONARY or typeof(data.lost) != TYPE_ARRAY:
		return null
	for id in data.xp_gained:
		battle.xp_gained[str(id)] = int(data.xp_gained[id])
	for entry in data.lost:
		if typeof(entry) != TYPE_DICTIONARY or not entry.has("cell") or not entry.has("upgrades"):
			return null
		var piece: Dictionary = entry.duplicate(true)
		piece.cell = Vector2i(int(entry.cell[0]), int(entry.cell[1]))
		piece.level = int(entry.level)
		piece.ward = int(entry.ward)
		battle.lost.append(piece)
	for id in data.promoted:
		battle.promoted.append(str(id))
	battle.captures = int(data.captures)
	battle.best_chain = int(data.best_chain)
	battle.gold_found = int(data.gold_found)
	return battle
