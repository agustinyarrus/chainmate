class_name Board
extends RefCounted







const SIZE: = 6
const TILE_STATES: Array[String] = ["frozen", "corrupted", "enchanted"]

var pieces: Array[Dictionary] = []
var tiles: Dictionary = {}
var _grid: Array = []


func _init() -> void :
	_grid.resize(SIZE * SIZE)


static func in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < SIZE and cell.y < SIZE


static func distance(a: Vector2i, b: Vector2i) -> int:
	return maxi(absi(a.x - b.x), absi(a.y - b.y))


static func make_piece(id: String, kind: String, friendly: bool, cell: Vector2i, level: = 0, upgrades: Array = []) -> Dictionary:
	return {
		"id": id, 
		"kind": kind, 
		"friendly": friendly, 
		"cell": cell, 
		"level": level, 
		"upgrades": upgrades.duplicate(), 
		"ward": upgrades.count("ward"), 
	}


func clone() -> Board:
	var copy: = Board.new()
	for piece in pieces:
		var entry: Dictionary = piece.duplicate()
		entry.upgrades = piece.upgrades.duplicate()
		copy.add(entry)
	copy.tiles = tiles.duplicate()
	return copy


func add(piece: Dictionary) -> void :
	pieces.append(piece)
	_grid[_index(piece.cell)] = piece



func insert(piece: Dictionary, index: int) -> void :
	pieces.insert(index, piece)
	_grid[_index(piece.cell)] = piece


func index_of(id: String) -> int:
	for i in pieces.size():
		if pieces[i].id == id:
			return i
	return -1


func remove(id: String) -> Dictionary:
	for i in range(pieces.size() - 1, -1, -1):
		var piece: = pieces[i]
		if piece.id == id:
			pieces.remove_at(i)
			if is_same(_grid[_index(piece.cell)], piece):
				_grid[_index(piece.cell)] = null
			return piece
	return {}


func move(id: String, cell: Vector2i) -> void :
	var piece: = piece_by_id(id)
	if is_same(_grid[_index(piece.cell)], piece):
		_grid[_index(piece.cell)] = null
	piece.cell = cell
	_grid[_index(cell)] = piece


func piece_at(cell: Vector2i) -> Dictionary:
	if not in_bounds(cell):
		return {}
	var piece = _grid[_index(cell)]
	return piece if piece != null else {}


func is_free(cell: Vector2i) -> bool:
	return in_bounds(cell) and _grid[_index(cell)] == null


func piece_by_id(id: String) -> Dictionary:
	for piece in pieces:
		if piece.id == id:
			return piece
	return {}


func has_piece(id: String) -> bool:
	return not piece_by_id(id).is_empty()


func side(friendly: bool) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for piece in pieces:
		if piece.friendly == friendly:
			out.append(piece)
	return out


func friendlies() -> Array[Dictionary]:
	return side(true)


func enemies() -> Array[Dictionary]:
	return side(false)


func king(friendly: bool) -> Dictionary:
	for piece in pieces:
		if piece.friendly == friendly and piece.kind == "king":
			return piece
	return {}


func tile(cell: Vector2i) -> String:
	return str(tiles.get(cell, ""))


func set_tile(cell: Vector2i, state: String) -> void :
	if state == "":
		tiles.erase(cell)
	else:
		tiles[cell] = state


func to_data() -> Dictionary:
	var entries: = []
	for piece in pieces:
		var entry: Dictionary = piece.duplicate()
		entry.cell = [piece.cell.x, piece.cell.y]
		entry.upgrades = Array(piece.upgrades)
		entries.append(entry)
	var tile_entries: = []
	for cell in tiles:
		tile_entries.append([cell.x, cell.y, tiles[cell]])
	return {"pieces": entries, "tiles": tile_entries}



static func from_data(data: Variant) -> Board:
	if typeof(data) != TYPE_DICTIONARY or not data.has("pieces") or not data.has("tiles"):
		return null
	if typeof(data.pieces) != TYPE_ARRAY or typeof(data.tiles) != TYPE_ARRAY:
		return null
	var board: = Board.new()
	for entry in data.pieces:
		if typeof(entry) != TYPE_DICTIONARY:
			return null
		for key in ["id", "kind", "friendly", "cell", "level", "upgrades", "ward"]:
			if not entry.has(key):
				return null
		var raw_cell = entry.cell
		if typeof(raw_cell) != TYPE_ARRAY or raw_cell.size() != 2 or typeof(entry.upgrades) != TYPE_ARRAY:
			return null
		var cell: = Vector2i(int(raw_cell[0]), int(raw_cell[1]))
		var kind: = str(entry.kind)
		if not in_bounds(cell) or not board.is_free(cell) or not ChessRules.KINDS.has(kind):
			return null
		var upgrades: = []
		for id in entry.upgrades:
			if not Upgrades.exists(str(id)):
				return null
			upgrades.append(str(id))
		var piece: = make_piece(str(entry.id), kind, bool(entry.friendly), cell, int(entry.level), upgrades)
		piece.ward = int(entry.ward)
		board.add(piece)
	for entry in data.tiles:
		if typeof(entry) != TYPE_ARRAY or entry.size() != 3:
			return null
		var cell: = Vector2i(int(entry[0]), int(entry[1]))
		var state: = str(entry[2])
		if not in_bounds(cell) or not TILE_STATES.has(state):
			return null
		board.tiles[cell] = state
	return board


func _index(cell: Vector2i) -> int:
	return cell.y * SIZE + cell.x
