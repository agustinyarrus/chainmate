class_name Encounters
extends RefCounted



const ACTS: = [
	{"name": "The Moss Ranks", "variant": "outpost", "tagline": "Ivy-choked ramparts in open daylight."}, 
	{"name": "The Sunken Files", "variant": "crypt", "tagline": "Cold, flooded galleries under the board."}, 
	{"name": "The Back Rank", "variant": "court", "tagline": "Where the enemy king holds court."}, 
]

const BUDGET: Array[int] = [7, 11, 15]
const ELITE_SCALE: = 1.45
const MAX_ENEMIES: = 9
const POOLS: = [
	{"pawn": 6, "knight": 2, "bishop": 2, "rook": 1}, 
	{"pawn": 5, "knight": 2, "bishop": 2, "rook": 2, "queen": 1}, 
	{"pawn": 4, "knight": 2, "bishop": 2, "rook": 2, "queen": 2}, 
]
const BOSSES: = [
	{"name": "Lucena of the Long File", "army": ["king", "rook", "rook", "pawn", "pawn", "pawn"], "rule": "piercing_rooks", 
		"desc": "Her rooks skewer: their captures pass through one piece."}, 
	{"name": "Canon Oblique", "army": ["king", "bishop", "bishop", "knight", "knight", "pawn", "pawn", "pawn"], "rule": "corrupting_pawns", 
		"desc": "His pawns are poisoned: take one and the square your piece left rots."}, 
	{"name": "The Dowager Zwischen", "army": ["king", "queen", "rook", "bishop", "knight", "pawn", "pawn", "pawn"], "rule": "double_move", 
		"desc": "Every third turn she slips in a second move."}, 
]

const TERRAIN: = [
	{"enchanted": [0, 2]}, 
	{"frozen": [1, 2], "corrupted": [0, 2]}, 
	{"corrupted": [1, 2], "enchanted": [0, 1], "frozen": [0, 1]}, 
]
const BACK_FILES: = {
	"king": [3, 2], "queen": [2, 4, 1], "rook": [0, 5, 1, 4], "bishop": [2, 4, 1, 5], 
	"knight": [1, 4, 2, 5, 0, 3], "pawn": [], 
}
const PAWN_FILES: Array[int] = [3, 2, 4, 1, 5, 0]
const PLACEMENT_ORDER: Array[String] = ["king", "queen", "rook", "bishop", "knight", "pawn"]



static func build(gs: GameState, node_type: String) -> Battle:
	var rng: = gs.rng
	var board: = Board.new()
	var friends: Array[Dictionary] = []
	for entry in gs.army:
		var upgrades: Array = entry.upgrades.duplicate()
		if entry.kind == "knight" and gs.relics.has("knights_tour_chart") and not upgrades.has("momentum"):
			upgrades.append("momentum")
		if entry.kind == "bishop" and gs.relics.has("fianchetto_glass") and not upgrades.has("piercing"):
			upgrades.append("piercing")
		if entry.kind == "pawn" and gs.relics.has("queening_charter"):
			upgrades.append("early_promotion")
		var piece: = Board.make_piece(str(entry.id), str(entry.kind), true, Vector2i.ZERO, int(entry.level), upgrades)
		if entry.kind == "rook" and gs.relics.has("castling_deed"):
			piece.ward = int(piece.ward) + 1
		if gs.fortified and entry.kind != "king":
			piece.ward = int(piece.ward) + 1
		friends.append(piece)
	_place(board, friends, true)

	var objective: = "eliminate"
	var rule: = ""
	var kinds: Array[String] = []
	var scale: float = GameState.DIFFICULTIES[gs.difficulty].budget_scale
	if node_type == "boss":
		var boss: Dictionary = BOSSES[gs.act]
		kinds.assign(boss.army)
		rule = boss.rule
		objective = "regicide"
		if gs.difficulty == "apprentice":
			kinds.erase("pawn")
		elif gs.difficulty == "grandmaster":
			kinds.append("pawn")
	else:
		var budget: = int(round(BUDGET[gs.act] * scale * (ELITE_SCALE if node_type == "elite" else 1.0)))
		kinds = _compose(rng, gs.act, budget)
	var foes: Array[Dictionary] = []
	for i in kinds.size():
		foes.append(Board.make_piece("e%d" % i, kinds[i], false, Vector2i.ZERO))
	if rule == "piercing_rooks":
		for foe in foes:
			if foe.kind == "rook":
				foe.upgrades.append("piercing")
	if node_type == "elite" or node_type == "boss":
		var champions: Array[Dictionary] = []
		for foe in foes:
			if foe.kind != "king" and foe.kind != "pawn":
				champions.append(foe)
		var promotions: = 1 if node_type == "elite" else gs.act
		for _i in mini(promotions, champions.size()):
			var champion: Dictionary = champions[rng.randi_range(0, champions.size() - 1)]
			champions.erase(champion)
			var pool: = Upgrades.pool_for(champion.kind, champion.upgrades)
			pool.erase("veteran")
			champion.level = 1
			if not pool.is_empty():
				var pick: = pool[rng.randi_range(0, pool.size() - 1)]
				champion.upgrades.append(pick)
				if pick == "ward":
					champion.ward = int(champion.ward) + 1
	_place(board, foes, false)

	if gs.relics.has("forfeit_slip"):
		var pawns: Array[Dictionary] = []
		for foe in board.enemies():
			if foe.kind == "pawn":
				pawns.append(foe)
		if not pawns.is_empty():
			board.remove(pawns[rng.randi_range(0, pawns.size() - 1)].id)

	_place_terrain(board, rng, gs.act)
	return Battle.create(board, gs.relics, objective, rule)




static func camp(army: Array[Dictionary]) -> Board:
	var board: = Board.new()
	var pieces: Array[Dictionary] = []
	for entry in army:
		pieces.append(Board.make_piece(str(entry.id), str(entry.kind), true, Vector2i.ZERO, int(entry.level), entry.upgrades.duplicate()))
	_place(board, pieces, true)
	return board



static func _compose(rng: RandomNumberGenerator, act: int, budget: int) -> Array[String]:
	var pool: Dictionary = POOLS[act]
	var kinds: Array[String] = []
	var spent: = 0
	var guard: = 0
	while spent < budget and kinds.size() < MAX_ENEMIES and guard < 80:
		guard += 1
		var kind: = _weighted(pool, rng)
		var cost: int = ChessRules.MATERIAL[kind]
		if spent + cost > budget + 1:
			continue
		kinds.append(kind)
		spent += cost
	while kinds.size() < 2:
		kinds.append("pawn")
	return kinds



static func _place(board: Board, pieces: Array[Dictionary], friendly: bool) -> void :
	var back: = Board.SIZE - 1 if friendly else 0
	var front: = Board.SIZE - 2 if friendly else 1
	var ordered: Array[Dictionary] = []
	for kind in PLACEMENT_ORDER:
		for piece in pieces:
			if piece.kind == kind:
				ordered.append(piece)
	for piece in ordered:
		var cell: = Vector2i(-1, -1)
		if piece.kind == "pawn":
			for file in PAWN_FILES:
				if board.is_free(Vector2i(file, front)):
					cell = Vector2i(file, front)
					break
		else:
			for file in BACK_FILES[piece.kind]:
				if board.is_free(Vector2i(file, back)):
					cell = Vector2i(file, back)
					break
		if cell.x < 0:
			for row in [back, front]:
				for file in PAWN_FILES:
					if cell.x < 0 and board.is_free(Vector2i(file, row)):
						cell = Vector2i(file, row)
		piece.cell = cell
		board.add(piece)


static func _place_terrain(board: Board, rng: RandomNumberGenerator, act: int) -> void :
	var plan: Dictionary = TERRAIN[act]
	var open: Array[Vector2i] = []
	for y in [2, 3]:
		for x in Board.SIZE:
			var cell: = Vector2i(x, y)
			if board.is_free(cell):
				open.append(cell)
	for state in plan:
		var count: = rng.randi_range(int(plan[state][0]), int(plan[state][1]))
		for _i in count:
			if open.is_empty():
				return
			var cell: = open[rng.randi_range(0, open.size() - 1)]
			open.erase(cell)
			board.set_tile(cell, state)


static func _weighted(pool: Dictionary, rng: RandomNumberGenerator) -> String:
	var total: = 0
	for kind in pool:
		total += int(pool[kind])
	var roll: = rng.randi_range(1, total)
	for kind in pool:
		roll -= int(pool[kind])
		if roll <= 0:
			return kind
	return pool.keys()[pool.size() - 1]
