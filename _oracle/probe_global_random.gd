extends RefCounted
## Oracle probe — GDScript's GLOBAL random functions, which are Math::… and not RandomNumberGenerator's:
## in Godot 4.7 `randf()` is Math::randf = (float)rand() / (float)UINT32_MAX (one word of the stream),
## `randf_range()` goes through RandomPCG::random(double, double), `randi_range()` through
## RandomPCG::random(int, int). Every sequence starts from seed(7) and ends with one randi(), so the port
## can tell how many words each call took; `words` are the raw stream itself. The port's globals must
## reproduce all of it (test/global_random.test.mjs).
##
##   node tools/oracle.mjs global_random

const WORDS := 64
const RANGES := [[-1.0, 1.0], [0.06, 0.15], [0.2, 0.8], [2.2, 4.2], [0.9, 1.5], [4.0, 14.0], [0.0, 1.0], [-0.15, 0.15], [5.0, -5.0], [3.0, 3.0]]
const INT_RANGES := [[0, 5], [-3, 3], [1, 100], [7, 7], [10, 0], [0, 2147483646]]


func _hex(x: float) -> String:
	return PackedFloat64Array([x]).to_byte_array().hex_encode()


func run(_host: Node) -> void:
	seed(7)
	var words := []
	for i in WORDS:
		words.append(randi())

	seed(7)
	var floats := []
	for i in 24:
		floats.append(_hex(randf()))
	var after_randf := randi()

	seed(7)
	var ranges := []
	for pair in RANGES:
		ranges.append(_hex(randf_range(pair[0], pair[1])))
	var after_ranges := randi()

	seed(7)
	var ints := []
	for pair in INT_RANGES:
		ints.append(randi_range(pair[0], pair[1]))
	var after_ints := randi()

	# The shapes the game writes: `randf() * 10.0` (piece idles), `randf() * 20.0` (flame seeds).
	seed(7)
	var scaled := [_hex(randf() * 10.0), _hex(randf() * 20.0)]

	print("ORACLE ", JSON.stringify({
		"k": "global", "words": words,
		"randf": floats, "after_randf": after_randf,
		"ranges": RANGES, "randf_range": ranges, "after_ranges": after_ranges,
		"int_ranges": INT_RANGES, "randi_range": ints, "after_ints": after_ints,
		"scaled": scaled,
	}))
