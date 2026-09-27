extends RefCounted
## Oracle probe #1 — engine primitives the port must reproduce bit for bit.
## Run with the patched build:  ChainmateOracle.exe --headless -- --oracle=<absolute path of this file>
## Every line printed as `ORACLE {json}` is parsed by tools/oracle.mjs into _oracle/primitives.json.
## Doubles are dumped as little-endian hex so the comparison never depends on float printing.


func _hex(x: float) -> String:
	return PackedFloat64Array([x]).to_byte_array().hex_encode()


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func run(_host: Node) -> void:
	_hashes()
	_pcg()
	_ranges()
	_noise()
	_sorting()
	_formatting()
	_float32_vectors()


func _hashes() -> void:
	for s in ["", "a", "ab", "CHAINMATE", "TOUR-7", "arena-outpost", "arena-crypt", "arena-court", "relic-appearance_fee",
			"relic-salt_horn", "BENCH-0", "Ñandú", "ç€𝄞", "music", "seed with spaces"]:
		_emit({"k": "hash_string", "s": s, "v": hash(s)})
	for s: StringName in [&"music", &"ui_hover", &"capture", &"victory"]:
		_emit({"k": "hash_stringname", "s": String(s), "v": hash(s)})


func _pcg() -> void:
	for seed_text in ["TOUR-7", "CHAINMATE", "arena-outpost"]:
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(seed_text)
		var entry := {"k": "pcg", "seed_text": seed_text, "seed": str(rng.seed), "state0": str(rng.state)}
		var ints := []
		for i in 16:
			ints.append(rng.randi())
		entry.randi = ints
		entry.state16 = str(rng.state)
		var floats := []
		for i in 16:
			floats.append(_hex(rng.randf()))
		entry.randf = floats
		entry.state32 = str(rng.state)
		_emit(entry)
	# Seeding with small integers (the autopilot uses 7, the synth 24301, block meshes 100+17k).
	for s in [0, 7, 11, 100, 24301, 1117]:
		var rng := RandomNumberGenerator.new()
		rng.seed = s
		var ints := []
		for i in 6:
			ints.append(rng.randi())
		_emit({"k": "pcg_small", "seed": s, "state0": str(rng.state), "randi": ints})
	# Restoring from a saved state (GameState.from_dict does seed then state).
	var a := RandomNumberGenerator.new()
	a.seed = hash("TOUR-7")
	for i in 5:
		a.randi()
	var saved := str(a.state)
	var b := RandomNumberGenerator.new()
	b.seed = hash("TOUR-7")
	b.state = saved.to_int()
	_emit({"k": "pcg_restore", "saved": saved, "a": a.randi(), "b": b.randi()})


func _ranges() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("ranges")
	var out := []
	var before := str(rng.state)
	var same := rng.randi_range(5, 5)
	out.append({"op": "randi_range(5,5)", "v": same, "consumed": str(rng.state) != before})
	for pair in [[0, 5], [1, 17], [0, 1], [-3, 3], [2, 3], [0, 31], [1, 1000], [10, 0]]:
		var vals := []
		for i in 8:
			vals.append(rng.randi_range(pair[0], pair[1]))
		out.append({"op": "randi_range(%d,%d)" % pair, "v": vals})
	for pair in [[-1.0, 1.0], [0.38, 0.6], [0.0, TAU], [-0.035, 0.035], [0.8, 1.25], [1500.0, 4600.0]]:
		var vals := []
		for i in 6:
			vals.append(_hex(rng.randf_range(pair[0], pair[1])))
		out.append({"op": "randf_range(%s,%s)" % [str(pair[0]), str(pair[1])], "v": vals})
	var mods := []
	for i in 8:
		mods.append(rng.randi() % 6)
	out.append({"op": "randi()%6", "v": mods})
	out.append({"op": "final_state", "v": str(rng.state)})
	_emit({"k": "ranges", "ops": out})


func _noise() -> void:
	var block := FastNoiseLite.new()
	block.seed = 100
	block.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	block.fractal_type = FastNoiseLite.FRACTAL_NONE
	block.frequency = 1.4
	var points := [Vector3(0.1, 0.2, 0.3), Vector3(-1.5, 2.25, 0.75), Vector3(10.0, -3.0, 7.5), Vector3(-37.2, 44.9, -12.05), Vector3(0.5, 0.5, 0.5)]
	var values3 := []
	for p: Vector3 in points:
		values3.append(_hex(block.get_noise_3dv(p)))
	_emit({"k": "noise3", "seed": 100, "freq": 1.4, "points": points.map(func(p: Vector3) -> Array: return [p.x, p.y, p.z]), "v": values3})
	var shake := FastNoiseLite.new()
	shake.seed = 11
	shake.frequency = 2.2
	var values2 := []
	for t in [0.0, 0.5, 1.3, 7.7, 33.3, 250.25]:
		values2.append([_hex(shake.get_noise_2d(t, 0.0)), _hex(shake.get_noise_2d(0.0, t)), _hex(shake.get_noise_2d(t * 0.8333, 99.0))])
	_emit({"k": "noise2", "seed": 11, "freq": 2.2, "defaults": {"type": shake.noise_type, "fractal": shake.fractal_type,
		"octaves": shake.fractal_octaves, "lacunarity": shake.fractal_lacunarity, "gain": shake.fractal_gain,
		"weighted": shake.fractal_weighted_strength, "offset": [shake.offset.x, shake.offset.y, shake.offset.z]}, "v": values2})


func _sorting() -> void:
	# Godot's Array.sort_custom is an introsort (not stable above 16 items): the port has to match its tie order.
	var rng := RandomNumberGenerator.new()
	rng.seed = 12345
	for n in [5, 16, 17, 40, 129]:
		var items := []
		for i in n:
			items.append({"id": i, "key": rng.randi_range(0, 4)})
		items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.key < b.key)
		_emit({"k": "sort_custom", "n": n, "ids": items.map(func(d: Dictionary) -> int: return d.id)})
	var mixed := [3, 1.5, -2, 10, 0, 7.25, 3, -2.5, 99, 4, 4, 1, 12, 8, 6, 5, 2, 11, 13]
	mixed.sort()
	_emit({"k": "sort_numbers", "v": mixed})
	var words := ["pawn", "Queen", "knight", "bishop", "Ñ", "rook", "king", "a", "B", "zeta", "éclair"]
	words.sort()
	_emit({"k": "sort_strings", "v": words})


func _formatting() -> void:
	var cases := []
	for x in [0.1, 1.0, 2.0 / 3.0, 1e20, -0.0, 123456.789, 0.25, 1.5e-7, 100.0]:
		cases.append({"str": str(x), "fmt_s": "%s" % x, "fmt_2f": "%.2f" % x, "fmt_d": "%d" % x})
	_emit({"k": "float_text", "v": cases})
	_emit({"k": "int_text", "v": ["%02d" % 5, "%+d" % 5, "%+d" % -5, "%5d|" % 42, "%-5d|" % 42, "%x" % 255, "%.1f" % 2.25, "%.1f" % 2.35,
		"%.0f" % 2.5, "%.0f" % 3.5, "%c" % 65, "%s|%s" % ["a", 1]]})
	_emit({"k": "string_ops", "v": [" tour-7 ".strip_edges().to_upper(), "straße".to_upper(), "hello_world".capitalize(),
		"HTTPRequest".capitalize(), "piece2go".capitalize(), "ABC".to_lower(), "a,b,,c".split(","), "x".repeat(3)]})
	_emit({"k": "math", "v": [_hex(fposmod(-1.25, 1.0)), _hex(fposmod(sin(float(3 * 13 + 2 * 7) * 12.9898) * 43758.5453, 1.0)),
		roundi(2.5), roundi(-2.5), round(-0.5), int(-3.7), -7 / 2, -7 % 3, posmod(-7, 3), snappedf(1.26, 0.05),
		_hex(lerpf(0.1, 0.9, 0.3)), _hex(ease(0.3, -2.0)), _hex(smoothstep(0.2, 0.8, 0.5)), _hex(deg_to_rad(34.0)),
		_hex(linear_to_db(0.8)), _hex(db_to_linear(-6.0)), _hex(exp(-0.1 * 6.0)), _hex(tan(deg_to_rad(34.0) * 0.5))]})


func _float32_vectors() -> void:
	# Vector3/Color are single precision in standard builds: arithmetic rounds every step to float32.
	var v := Vector3(0.1, 0.2, 0.3)
	var w := v * 1.55 + Vector3(0.7, -0.3, 0.05)
	var n := w.normalized()
	var basis := Basis(Vector3.UP, 0.42)
	var rotated := basis * Vector3(1.0, 2.0, 3.0)
	var look := Basis.looking_at(Vector3(0.78, -0.56, 0.3).normalized(), Vector3.UP)
	_emit({"k": "vec32", "v": [_hex(v.x), _hex(w.x), _hex(w.y), _hex(n.x), _hex(n.z), _hex(rotated.x), _hex(rotated.z),
		_hex(look.x.x), _hex(look.z.y), _hex(Color("d9c39f").r), _hex(Color("d9c39f").srgb_to_linear().r),
		_hex(Color(0.2, 0.4, 0.6).lightened(0.3).g), _hex(Color(0.2, 0.4, 0.6).darkened(0.35).b)]})
