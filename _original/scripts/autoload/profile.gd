extends Node





const PROFILE_VERSION: = 2
const HISTORY_LENGTH: = 12

const UNLOCKS: = {
	"army_cavalry": {"name": "Hussars army", "hint": "Defeat Lucena of the Long File, the first boss."}, 
	"army_cathedral": {"name": "Bishop Pair army", "hint": "Defeat Canon Oblique, the second boss."}, 
	"army_phalanx": {"name": "Pawn Chain army", "hint": "Win a run."}, 
	"difficulty_grandmaster": {"name": "Grandmaster difficulty", "hint": "Win a run on Tournament."}, 
}

var data: Dictionary = {}

var recovered: = false
var _folder: = "user://"


func _ready() -> void :
	var args: = OS.get_cmdline_user_args()
	if args.has("--capture") or args.has("--ephemeral"):
		_folder = "user://sandbox/"
		DirAccess.make_dir_recursive_absolute(_folder)
		if args.has("--capture"):
			clear_run()
			_write_json(_folder + "profile.json", _default_profile())
	var path: = _folder + "profile.json"
	var stored = _read_json(path)
	if stored == null:
		data = _default_profile()
	elif _valid_profile(stored):
		data = stored
	else:
		DirAccess.rename_absolute(path, path + ".corrupt")
		data = _default_profile()
		recovered = true
		_save_profile()




func is_unlocked(id: String) -> bool:
	return Array(data.unlocks).has(id)


func army_available(preset: String) -> bool:
	return preset == "vanguard" or is_unlocked("army_" + preset)


func difficulty_available(difficulty: String) -> bool:
	return difficulty != "grandmaster" or is_unlocked("difficulty_grandmaster")


func unlock_hint(id: String) -> String:
	return str(UNLOCKS[id].hint)


func _unlock(id: String, fresh: Array[String]) -> void :
	if is_unlocked(id):
		return
	data.unlocks.append(id)
	fresh.append(id)





func record_boss(gs: GameState) -> Array[String]:
	var fresh: Array[String] = []
	data.bosses = int(data.bosses) + 1
	if gs.act >= 0:
		_unlock("army_cavalry", fresh)
	if gs.act >= 1:
		_unlock("army_cathedral", fresh)
	_save_profile()
	return fresh



func record_run_end(gs: GameState, won: bool) -> Array[String]:
	var fresh: Array[String] = []
	data.runs = int(data.runs) + 1
	data.total_captures = int(data.total_captures) + int(gs.stats.captures)
	data.best_chain = maxi(int(data.best_chain), int(gs.stats.best_chain))
	data.best_encounters = maxi(int(data.best_encounters), gs.encounters_won)
	data.best_by_difficulty[gs.difficulty] = maxi(int(data.best_by_difficulty[gs.difficulty]), gs.encounters_won)
	if won:
		data.wins = int(data.wins) + 1
		data.wins_by_difficulty[gs.difficulty] = int(data.wins_by_difficulty[gs.difficulty]) + 1
		_unlock("army_phalanx", fresh)
		if gs.difficulty == "standard" or gs.difficulty == "grandmaster":
			_unlock("difficulty_grandmaster", fresh)
	var history: Array = data.history
	history.push_front({
		"won": won, 
		"encounters": gs.encounters_won, 
		"difficulty": gs.difficulty, 
		"army": gs.army_preset, 
		"seed": gs.seed_text, 
		"relics": Array(gs.relics), 
		"survivors": gs.army.size(), 
		"date": Time.get_date_string_from_system(), 
	})
	while history.size() > HISTORY_LENGTH:
		history.pop_back()
	_save_profile()
	return fresh


func best_for(difficulty: String) -> int:
	return int(data.best_by_difficulty[difficulty])


func mark_tutorial_done() -> void :
	if not data.tutorial_done:
		data.tutorial_done = true
		_save_profile()




func save_run(gs: GameState) -> void :
	if gs == null or gs.phase == "lost" or gs.phase == "won":
		clear_run()
		return
	_write_json(_folder + "run.json", gs.to_dict())



func load_run() -> GameState:
	var stored = _read_json(_folder + "run.json")
	return GameState.from_dict(stored) if stored != null else null


func has_run() -> bool:
	return load_run() != null


func clear_run() -> void :
	var path: = _folder + "run.json"
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)




func _default_profile() -> Dictionary:
	var per_difficulty: = {}
	for key in GameState.DIFFICULTIES:
		per_difficulty[key] = 0
	return {
		"version": PROFILE_VERSION, 
		"runs": 0, 
		"wins": 0, 
		"bosses": 0, 
		"best_encounters": 0, 
		"best_chain": 0, 
		"total_captures": 0, 
		"best_by_difficulty": per_difficulty.duplicate(), 
		"wins_by_difficulty": per_difficulty.duplicate(), 
		"unlocks": [], 
		"history": [], 
		"tutorial_done": false, 
	}



func _valid_profile(stored: Variant) -> bool:
	if typeof(stored) != TYPE_DICTIONARY or int(stored.get("version", -1)) != PROFILE_VERSION:
		return false
	var reference: = _default_profile()
	for key in reference:
		if not stored.has(key):
			return false
		var expected: = typeof(reference[key])
		var actual: = typeof(stored[key])
		var numeric: = (expected == TYPE_INT or expected == TYPE_FLOAT) and (actual == TYPE_INT or actual == TYPE_FLOAT)
		if actual != expected and not numeric:
			return false
	for key in GameState.DIFFICULTIES:
		if not stored.best_by_difficulty.has(key) or not stored.wins_by_difficulty.has(key):
			return false
	for entry in stored.history:
		if typeof(entry) != TYPE_DICTIONARY:
			return false
		for field in ["won", "encounters", "difficulty", "army", "seed", "survivors"]:
			if not entry.has(field):
				return false
		if not GameState.DIFFICULTIES.has(str(entry.difficulty)) or not GameState.ARMIES.has(str(entry.army)):
			return false
	return true


func _save_profile() -> void :
	_write_json(_folder + "profile.json", data)


func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var text: = FileAccess.get_file_as_string(path)
	if text == "":
		return null
	return JSON.parse_string(text)



func _write_json(path: String, value: Variant) -> void :
	var temp: = path + ".tmp"
	var file: = FileAccess.open(temp, FileAccess.WRITE)
	if file == null:
		push_warning("Could not write %s" % path)
		return
	file.store_string(JSON.stringify(value, "\t"))
	file.close()
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(path)
	DirAccess.rename_absolute(temp, path)
