extends RefCounted

















const SFX_RATE: = 44100
const MID_RATE: = 22050
const LOW_RATE: = 11025
const MUSIC_RATE: = 22050
const MUSIC_LOOP_SECONDS: = 32.0

const MUSIC_TAIL_SECONDS: = 10.0

const MUSIC_PEAK: = 0.25

const MUSIC_GUARD: = 8

const NOISE_SIZE: = 65536
const NOISE_MASK: = NOISE_SIZE - 1
const TABLE_SIZE: = 2048
const TABLE_MASK: = TABLE_SIZE - 1
const LN_1000: = 6.907755278982137

const SILENCE: = 0.0001

enum Filter{LOW, BAND, HIGH}

const SOUND_NAMES: Array[StringName] = [
	&"ui_hover", &"ui_click", &"ui_back", &"select", &"deselect", &"move", &"enemy_move", &"land", 
	&"capture", &"shatter", &"chain_step", &"check", &"coin", &"relic_trigger", &"encounter_start", 
	&"encounter_won", &"lost", &"victory", &"purchase", &"train", &"level_up", &"promote", 
	&"map_step", &"error", 
]

const BUILD_COST: Dictionary[StringName, int] = {
	&"ui_hover": 1, &"ui_click": 1, &"ui_back": 1, &"select": 2, &"deselect": 1, &"move": 2, 
	&"enemy_move": 2, &"land": 1, &"capture": 3, &"shatter": 6, &"chain_step": 7, &"check": 12, 
	&"coin": 3, &"relic_trigger": 7, &"encounter_start": 20, &"encounter_won": 17, &"lost": 10, 
	&"victory": 36, &"purchase": 9, &"train": 6, &"level_up": 10, &"promote": 10, &"map_step": 3, 
	&"error": 3, 
}


const D5: = 587.33
const D2: = D5 * 0.125
const A2: = 110.0
const D3: = D5 * 0.25
const E3: = 164.814
const F3: = 174.614
const G3: = 195.998
const A3: = 220.0
const BB3: = 233.082
const B3: = 246.942
const D4: = D5 * 0.5
const E4: = 329.628
const F4: = 349.228
const FS4: = 369.994
const G4: = 391.995
const A4: = 440.0
const B4: = 493.883
const C5: = 523.251
const F5: = 698.456
const FS5: = 739.989
const A5: = 880.0
const D6: = D5 * 2.0
const E6: = 1318.51
const FS6: = 1479.978
const A6: = 1760.0
const B6: = 1975.533
const D7: = D5 * 4.0


const WOOD_KNOCK: Array[float] = [1.0, 1.0, 0.07, 1.58, 0.5, 0.045, 2.45, 0.32, 0.028, 3.93, 0.14, 0.012]
const STONE_KNOCK: Array[float] = [1.0, 1.0, 0.05, 1.71, 0.55, 0.034, 3.07, 0.3, 0.014]
const CHIME_BASE: = D5
const CHIME_MODES: Array[float] = [
	1.0, 1.0, 1.4, 
	1.0028, 0.45, 1.2, 
	2.0, 0.22, 0.8, 
	2.756, 0.42, 0.6, 
	4.07, 0.13, 0.38, 
	5.404, 0.16, 0.28, 
	8.933, 0.05, 0.12, 
]
const GLASS_BASE: = D6
const GLASS_MODES: Array[float] = [1.0, 1.0, 0.75, 1.0024, 0.8, 0.7, 2.0, 0.07, 0.35, 2.94, 0.05, 0.2]
const PING_BASE: = B6
const PING_MODES: Array[float] = [1.0, 1.0, 0.42, 1.0042, 0.6, 0.4, 2.405, 0.42, 0.22, 3.87, 0.2, 0.12, 5.52, 0.1, 0.06]
const WARM_BASE: = D3
const WARM_MODES: Array[float] = [1.0, 1.0, 1.8, 2.0, 0.5, 1.2, 3.0, 0.3, 0.8, 4.0, 0.16, 0.55, 5.0, 0.08, 0.4, 6.0, 0.04, 0.3]
const ANVIL_MODES: Array[float] = [
	1.0, 1.0, 0.9, 1.006, 0.6, 0.8, 1.47, 0.6, 0.6, 2.09, 0.55, 0.5, 
	2.56, 0.4, 0.4, 3.14, 0.3, 0.3, 3.88, 0.2, 0.2, 4.53, 0.1, 0.12, 
]

const DULL_BELL_MODES: Array[float] = [0.5, 0.6, 1.8, 1.0, 0.5, 1.2, 1.189, 0.4, 1.0, 1.5, 0.2, 0.7, 2.0, 0.3, 0.6, 2.51, 0.1, 0.35]
const GONG_STRIKE: Array[float] = [1.0, 0.8, 1.9, 1.52, 0.55, 1.6]
const GONG_BLOOM: Array[float] = [2.03, 0.35, 1.3, 2.48, 0.4, 1.2, 2.93, 0.3, 1.0, 3.46, 0.25, 0.9, 4.12, 0.2, 0.8, 4.63, 0.15, 0.7]
const GONG_SHIMMER: Array[float] = [7.1, 1.0, 1.1, 9.3, 1.0, 1.1, 12.4, 1.0, 1.1, 15.8, 1.0, 1.1]
const MUSIC_BELL_MODES: Array[float] = [1.0, 1.0, 3.2, 1.0021, 0.45, 2.9, 2.0, 0.16, 1.8, 2.756, 0.2, 1.1, 4.07, 0.05, 0.6, 5.404, 0.06, 0.45]



const DRONE_PERIOD: = 600
const DRONE_LEVEL: = 0.15
const PAD_LEVEL: = 0.105
const PAD_TILE_SECONDS: = 2.0
const BELL_LEVEL: = 0.65
const BELL_ECHO_DELAY: = 0.55
const BELL_ECHO_LEVEL: = 0.28
const AIR_LEVEL: = 0.45
const AIR_PERIOD_SECONDS: = 8.0

const MUSIC_CHORD_SIZE: = 4
const MUSIC_CHORDS: Array[float] = [
	F3, A3, D4, E4, 
	F3, BB3, D4, F4, 
	G3, BB3, D4, F4, 
	E3, A3, D4, E4, 
]

const MUSIC_BELLS: Array[float] = [
	2.0, A4, 0.7, -0.35, 
	5.5, D5, 0.5, 0.3, 
	7.25, C5, 0.4, 0.1, 
	11.0, F4, 0.6, -0.2, 
	14.5, G4, 0.45, 0.4, 
	18.0, A4, 0.6, -0.4, 
	19.75, C5, 0.42, 0.25, 
	25.0, F5, 0.35, 0.45, 
	26.5, D5, 0.5, -0.1, 
	30.0, A4, 0.3, 0.2, 
]



class Layer:
	var data: = PackedFloat32Array()
	var rate: = 0

	func _init(seconds: float, sample_rate: int) -> void :
		rate = sample_rate
		data.resize(maxi(1, ceili(seconds * sample_rate)))
		data.fill(0.0)


var _rng: = RandomNumberGenerator.new()
var _noise_table: = PackedFloat32Array()
var _tables: = {}
var _templates: = {}




func _init(source: Object = null) -> void :
	if source != null:
		var tables: Dictionary = source.get("_tables")
		var templates: Dictionary = source.get("_templates")
		_noise_table = source.get("_noise_table")
		_tables = tables.duplicate()
		_templates = templates.duplicate()
		return
	_rng.seed = 24301
	_noise_table.resize(NOISE_SIZE)
	for i in NOISE_SIZE:
		_noise_table[i] = _rng.randf_range(-1.0, 1.0)






func prepare() -> void :
	_chime()
	_glass()
	_ping()
	_warm()
	for table: StringName in [&"pad", &"horn", &"soft", &"buzz"]:
		_table(table)



func render(sound: StringName) -> PackedFloat32Array:
	_rng.seed = hash(sound)
	match sound:
		&"ui_hover":
			return _ui_hover()
		&"ui_click":
			return _ui_click()
		&"ui_back":
			return _ui_back()
		&"select":
			return _select()
		&"deselect":
			return _deselect()
		&"move":
			return _move()
		&"enemy_move":
			return _enemy_move()
		&"land":
			return _land()
		&"capture":
			return _capture()
		&"shatter":
			return _shatter()
		&"chain_step":
			return _chain_step()
		&"check":
			return _check()
		&"coin":
			return _coin()
		&"relic_trigger":
			return _relic_trigger()
		&"encounter_start":
			return _encounter_start()
		&"encounter_won":
			return _encounter_won()
		&"lost":
			return _lost()
		&"victory":
			return _victory()
		&"purchase":
			return _purchase()
		&"train":
			return _train()
		&"level_up":
			return _level_up()
		&"promote":
			return _promote()
		&"map_step":
			return _map_step()
		&"error":
			return _error()
	assert (false, "AudioSynth: unknown sound '%s'" % sound)
	return PackedFloat32Array()



func build(sound: StringName) -> AudioStreamWAV:
	var samples: = render(sound)
	if samples.is_empty():
		return null
	return to_wav(samples, SFX_RATE)




func render_music() -> Array[PackedFloat32Array]:
	_rng.seed = hash(&"music")
	var loop_n: = roundi(MUSIC_LOOP_SECONDS * MUSIC_RATE)
	var left: = Layer.new(MUSIC_LOOP_SECONDS + MUSIC_TAIL_SECONDS, MUSIC_RATE)
	var right: = Layer.new(MUSIC_LOOP_SECONDS + MUSIC_TAIL_SECONDS, MUSIC_RATE)

	_music_pad(left, right)
	_music_bells(left, right)
	_fold_tail(left, loop_n)
	_fold_tail(right, loop_n)

	_music_drone(left, right)
	_music_air(left, right)
	var top: = maxf(_peak(left.data), _peak(right.data))
	if top > 0.0:
		_scale(left.data, MUSIC_PEAK / top)
		_scale(right.data, MUSIC_PEAK / top)
	var channels: Array[PackedFloat32Array] = [left.data, right.data]
	return channels



func build_music() -> AudioStreamWAV:
	var channels: = render_music()
	return to_looping_wav(channels[0], channels[1], MUSIC_RATE)



static func batches(count: int) -> Array[Array]:
	var groups: Array[Array] = []
	var loads: = PackedInt32Array()
	for i in maxi(1, count):
		groups.append([])
		loads.append(0)
	var order: Array[StringName] = SOUND_NAMES.duplicate()
	order.sort_custom( func(a: StringName, b: StringName) -> bool: return BUILD_COST.get(a, 1) > BUILD_COST.get(b, 1))
	for sound: StringName in order:
		var lightest: = 0
		for i in groups.size():
			if loads[i] < loads[lightest]:
				lightest = i
		var cost: int = BUILD_COST.get(sound, 1)
		groups[lightest].append(sound)
		loads[lightest] += cost
	return groups



static func to_wav(samples: PackedFloat32Array, rate: int) -> AudioStreamWAV:
	return AudioStreamWAV.load_from_buffer(_float_wav_bytes(samples, rate, 1), {"compress/mode": 0})





static func to_looping_wav(left: PackedFloat32Array, right: PackedFloat32Array, rate: int) -> AudioStreamWAV:
	var n: = left.size()
	var frames: = PackedFloat32Array()
	frames.resize((n + MUSIC_GUARD) * 2)
	for i in n:
		frames[2 * i] = left[i]
		frames[2 * i + 1] = right[i]
	for k in MUSIC_GUARD:
		frames[2 * (n + k)] = left[k]
		frames[2 * (n + k) + 1] = right[k]
	var wav: = AudioStreamWAV.load_from_buffer(_float_wav_bytes(frames, rate, 2), {"compress/mode": 0})
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = n
	return wav



static func _float_wav_bytes(samples: PackedFloat32Array, rate: int, channels: int) -> PackedByteArray:
	var data: = samples.to_byte_array()
	var bytes: = PackedByteArray()
	bytes.resize(44)
	bytes.encode_u32(0, 1179011410)
	bytes.encode_u32(4, 36 + data.size())
	bytes.encode_u32(8, 1163280727)
	bytes.encode_u32(12, 544501094)
	bytes.encode_u32(16, 16)
	bytes.encode_u16(20, 3)
	bytes.encode_u16(22, channels)
	bytes.encode_u32(24, rate)
	bytes.encode_u32(28, rate * 4 * channels)
	bytes.encode_u16(32, 4 * channels)
	bytes.encode_u16(34, 32)
	bytes.encode_u32(36, 1635017060)
	bytes.encode_u32(40, data.size())
	bytes.append_array(data)
	return bytes




func _ui_hover() -> PackedFloat32Array:
	var s: = Layer.new(0.022, SFX_RATE)
	_strike(s, 0.0, 3350.0, 1.0, [1.0, 1.0, 0.01, 1.561, 0.4, 0.005])
	_click(s, 0.0, 0.35, 2500.0, Filter.HIGH, 0.0012)
	return _finish(s, 0.22)


func _ui_click() -> PackedFloat32Array:
	var s: = Layer.new(0.07, SFX_RATE)
	_strike(s, 0.0, 1180.0, 1.0, [1.0, 1.0, 0.045, 1.64, 0.5, 0.028, 2.73, 0.28, 0.014, 4.18, 0.1, 0.007])
	_click(s, 0.0, 0.45, 3200.0, Filter.BAND, 0.002)
	return _finish(s, 0.4)


func _ui_back() -> PackedFloat32Array:
	var s: = Layer.new(0.08, SFX_RATE)
	_strike(s, 0.0, 760.0, 1.0, [1.0, 1.0, 0.05, 1.58, 0.42, 0.03, 2.61, 0.18, 0.014])
	_click(s, 0.0, 0.3, 1800.0, Filter.LOW, 0.002)
	return _finish(s, 0.34)


func _error() -> PackedFloat32Array:
	var s: = Layer.new(0.22, SFX_RATE)
	_thump(s, 0.0, 150.0, 95.0, 0.03, 0.8, 0.14)

	_voice(s, _table(&"buzz"), 0.0, 0.17, 98.0, 0.3, 0.005, 0.08)
	_click(s, 0.0, 0.2, 900.0, Filter.LOW, 0.003)
	return _finish(s, 0.21)




func _select() -> PackedFloat32Array:
	var s: = Layer.new(0.22, SFX_RATE)
	_strike(s, 0.0, 640.0, 1.0, WOOD_KNOCK)
	_thump(s, 0.0, 300.0, 210.0, 0.015, 0.35, 0.05)
	_click(s, 0.0, 0.4, 2800.0, Filter.BAND, 0.0025)

	_noise(s, 0.015, 0.19, 0.05, 0.06, 0.16, Filter.BAND, 1300.0, 1.1, 4200.0)
	return _finish(s, 0.7)


func _deselect() -> PackedFloat32Array:
	var s: = Layer.new(0.2, SFX_RATE)

	_noise(s, 0.0, 0.07, 0.1, 0.065, 0.2, Filter.BAND, 3600.0, 1.0, 1300.0)
	_strike(s, 0.06, 540.0, 0.8, [1.0, 1.0, 0.06, 1.58, 0.38, 0.04, 2.45, 0.18, 0.022])
	_thump(s, 0.06, 240.0, 170.0, 0.015, 0.25, 0.05)
	_click(s, 0.06, 0.18, 1800.0, Filter.LOW, 0.002)
	return _finish(s, 0.57)


func _move() -> PackedFloat32Array:
	var s: = Layer.new(0.3, SFX_RATE)

	_noise(s, 0.0, 0.12, 0.2, 0.035, 0.3, Filter.BAND, 1500.0, 0.9, 2300.0, 0.7)
	_thock(s, 0.105, 1.0)
	return _finish(s, 0.88)



func _enemy_move() -> PackedFloat32Array:
	var s: = Layer.new(0.34, SFX_RATE)
	_noise(s, 0.0, 0.14, 0.24, 0.04, 0.3, Filter.BAND, 900.0, 0.8, 1400.0, 0.9)
	_thump(s, 0.12, 150.0, 90.0, 0.025, 0.6, 0.12)
	_strike(s, 0.12, 420.0, 0.9, STONE_KNOCK)
	_strike(s, 0.12, 1260.0, 0.18, [1.0, 1.0, 0.09, 2.31, 0.4, 0.05])
	_click(s, 0.12, 0.5, 2400.0, Filter.BAND, 0.003)
	return _finish(s, 0.88)


func _land() -> PackedFloat32Array:
	var s: = Layer.new(0.2, SFX_RATE)
	_thock(s, 0.0, 1.0)
	return _finish(s, 0.87)


func _capture() -> PackedFloat32Array:
	var s: = Layer.new(0.36, SFX_RATE)
	_click(s, 0.0, 1.0, 2500.0, Filter.HIGH, 0.003)
	_thump(s, 0.0, 170.0, 85.0, 0.03, 0.55, 0.18)
	_strike(s, 0.0, 450.0, 0.85, [1.0, 1.0, 0.08, 1.62, 0.55, 0.05, 2.57, 0.35, 0.03, 7.44, 0.4, 0.012])

	_noise(s, 0.002, 0.1, 0.9, 0.001, 0.08, Filter.BAND, 2700.0, 1.3, 1700.0)
	for i in 12:
		var t: = _rng.randf_range(0.0, 0.045)
		_mode(s, t, _rng.randf_range(1400.0, 4600.0), _rng.randf_range(0.1, 0.3), _rng.randf_range(0.004, 0.012))
	_saturate(s, 2.0)
	return _finish(s, 0.95)


func _shatter() -> PackedFloat32Array:
	var s: = Layer.new(0.6, SFX_RATE)
	var mid: = Layer.new(0.6, MID_RATE)
	_noise(s, 0.0, 0.14, 0.7, 0.0005, 0.08, Filter.BAND, 3200.0, 0.6)
	_noise(mid, 0.0, 0.4, 0.2, 0.004, 0.28, Filter.BAND, 5000.0, 0.8)
	_mix(s, mid, 0.0, 1.0, 1.0)
	_thump(s, 0.0, 260.0, 150.0, 0.02, 0.35, 0.06)

	for i in 36:
		var t: = minf( - log(1.0 - _rng.randf() * 0.995) * 0.08, 0.5)
		var freq: = 1500.0 * pow(4.0, _rng.randf())
		var amp: = 0.35 * _rng.randf_range(0.25, 1.0) * exp( - t / 0.22)
		var decay: = _rng.randf_range(0.006, 0.03)

		var ring: = 2.37 if _rng.randf() < 0.4 else 0.0
		_mode_pair(s, t, freq, amp, decay, freq * ring, amp * 0.5, decay * 0.6)
		_mode(s, t + _rng.randf_range(0.0, 0.03), freq * _rng.randf_range(0.6, 1.4), amp * 0.7, decay)
	return _finish(s, 0.65)



func _thock(s: Layer, t: float, amp: float) -> void :
	_thump(s, t, 190.0, 125.0, 0.02, amp * 0.5, 0.09)
	_strike(s, t, 560.0, amp, STONE_KNOCK)
	_click(s, t, amp * 0.6, 3000.0, Filter.BAND, 0.003)




func _chain_step() -> PackedFloat32Array:


	var s: = Layer.new(1.3, SFX_RATE)
	_strike(s, 0.0, CHIME_BASE, 1.0, CHIME_MODES)
	_click(s, 0.0, 0.1, 4500.0, Filter.BAND, 0.002)

	_strike(s, 0.0, 2350.0, 0.35, [1.0, 1.0, 0.02, 1.49, 0.5, 0.012])
	_click(s, 0.0, 0.3, 4200.0, Filter.BAND, 0.0025)
	return _finish(s, 0.54)



func _check() -> PackedFloat32Array:
	var s: = Layer.new(1.6, SFX_RATE)
	var low: = Layer.new(1.6, LOW_RATE)
	_thump(low, 0.0, 110.0, 55.0, 0.05, 0.7, 0.6)
	_strike(low, 0.0, A3, 0.6, DULL_BELL_MODES)
	_strike(low, 0.0, BB3, 0.32, DULL_BELL_MODES)
	_mix(s, low, 0.0, 1.0, 1.0)
	_click(s, 0.0, 0.4, 1400.0, Filter.BAND, 0.004)
	_hiss(s, 0.0, 0.5, 0.03, 0.05, 0.4)
	return _finish(s, 0.8)

func _relic_trigger() -> PackedFloat32Array:
	var s: = Layer.new(0.8, SFX_RATE)
	var mid: = Layer.new(0.8, MID_RATE)
	var notes: Array[float] = [D6, E6, FS6, A6, B6, D7]
	for k in notes.size():
		_mix(mid, _glass(), 0.035 * k, notes[k] / GLASS_BASE, 0.5 + 0.06 * k)
	_mix(s, mid, 0.0, 1.0, 1.0)
	_hiss(s, 0.0, 0.45, 0.045, 0.12, 0.3)
	return _finish(s, 0.43)




func _coin() -> PackedFloat32Array:
	var s: = Layer.new(0.55, SFX_RATE)
	_mix(s, _ping(), 0.0, 1.0, 0.8)
	_mix(s, _ping(), 0.07, 1.335, 1.0)
	return _finish(s, 0.45)


func _purchase() -> PackedFloat32Array:
	var s: = Layer.new(0.95, SFX_RATE)
	_anvil(s, 0.0, 1.0)
	_mix(s, _ping(), 0.16, 1.0, 0.35)
	_mix(s, _ping(), 0.23, 1.335, 0.42)
	return _finish(s, 0.85)


func _train() -> PackedFloat32Array:
	var s: = Layer.new(0.85, SFX_RATE)

	_click(s, 0.0, 0.8, 2200.0, Filter.HIGH, 0.003)
	_strike(s, 0.0, 640.0, 0.5, [1.0, 1.0, 0.35, 1.51, 0.6, 0.28, 2.12, 0.45, 0.2, 2.83, 0.25, 0.12])
	_thump(s, 0.0, 180.0, 110.0, 0.02, 0.5, 0.1)

	var mid: = Layer.new(0.85, MID_RATE)
	_noise(mid, 0.05, 0.78, 0.3, 0.03, 0.7, Filter.HIGH, 2500.0, 0.7, 4000.0, 0.9)
	_mix(s, mid, 0.0, 1.0, 1.0)
	for i in 26:
		var t: = 0.06 + _rng.randf() * _rng.randf() * 0.6
		_click(s, t, _rng.randf_range(0.1, 0.35) * exp( - t / 0.4), _rng.randf_range(3000.0, 7000.0), Filter.BAND, 0.001)
	return _finish(s, 0.95)



func _anvil(s: Layer, t: float, amp: float) -> void :
	_click(s, t, amp * 0.9, 3000.0, Filter.HIGH, 0.003)
	_strike(s, t, 920.0, amp * 0.5, ANVIL_MODES)
	_thump(s, t, 220.0, 150.0, 0.02, amp * 0.3, 0.08)




func _encounter_start() -> PackedFloat32Array:
	var s: = Layer.new(2.2, SFX_RATE)
	var mid: = Layer.new(2.2, MID_RATE)
	var low: = Layer.new(2.2, LOW_RATE)
	_thump(low, 0.0, 92.0, 52.0, 0.06, 1.0, 0.9)

	_strike(low, 0.0, A2, 0.7, GONG_STRIKE)
	_bloom(low, 0.0, A2, 0.7, GONG_BLOOM, 0.32)
	_mix(mid, low, 0.0, 1.0, 1.0)
	_bloom(mid, 0.0, A2, 0.05, GONG_SHIMMER, 0.35)
	_noise(mid, 0.0, 1.3, 0.05, 0.45, 1.0, Filter.BAND, 2600.0, 0.8)
	_mix(s, mid, 0.0, 1.0, 1.0)
	_click(s, 0.0, 0.25, 900.0, Filter.LOW, 0.006)
	return _finish(s, 0.73)


func _encounter_won() -> PackedFloat32Array:
	var s: = Layer.new(1.8, SFX_RATE)
	var mid: = Layer.new(1.8, MID_RATE)
	var low: = Layer.new(1.8, LOW_RATE)
	_pad_chord(low, 0.0, 1.8, [D3, A3, D4, FS4], 0.13, 0.3, 1.1)
	_thump(low, 0.0, 120.0, 73.4, 0.04, 0.35, 0.45)
	_mix(mid, low, 0.0, 1.0, 1.0)
	var arpeggio: Array[float] = [D5, FS5, A5, D6]
	for k in arpeggio.size():
		_mix(mid, _chime(), 0.11 * k, arpeggio[k] / CHIME_BASE, 0.55 + 0.1 * k)
	_mix(s, mid, 0.0, 1.0, 1.0)
	return _finish(s, 0.54)


func _lost() -> PackedFloat32Array:
	var s: = Layer.new(1.8, SFX_RATE)
	var low: = Layer.new(1.8, LOW_RATE)

	_melody(low, _table(&"horn"), 0.0, 1.78, [0.0, A3, 0.45, F3, 0.9, D3], 0.35, 0.12, 0.7)
	_voice(low, _table(&"pad"), 0.0, 1.78, D2, 0.18, 0.3, 1.1)
	_strike(low, 0.0, D4, 0.5, DULL_BELL_MODES)
	_mix(s, low, 0.0, 1.0, 1.0)
	_click(s, 0.0, 0.15, 1200.0, Filter.LOW, 0.004)
	return _finish(s, 0.54)


func _victory() -> PackedFloat32Array:
	var s: = Layer.new(3.0, SFX_RATE)
	var mid: = Layer.new(3.0, MID_RATE)
	var low: = Layer.new(3.0, LOW_RATE)
	_thump(low, 0.0, 100.0, 50.0, 0.06, 0.8, 0.9)

	_pad_chord(low, 0.0, 1.35, [D3, G3, B3], 0.14, 0.35, 0.35)
	_pad_chord(low, 1.1, 1.9, [D3, A3, D4, FS4], 0.14, 0.3, 1.2)
	_mix(mid, low, 0.0, 1.0, 1.0)
	var rise: Array[float] = [G4, B4, D5]
	for k in rise.size():
		_mix(mid, _chime(), 0.12 * k, rise[k] / CHIME_BASE, 0.38 + 0.05 * k)
	var crown: Array[float] = [D5, FS5, A5, D6]
	for k in crown.size():
		_mix(mid, _chime(), 1.15 + 0.085 * k, crown[k] / CHIME_BASE, 0.45 + 0.06 * k)
	_mix(s, mid, 0.0, 1.0, 1.0)

	_mix(s, _chime(), 1.15 + 0.085 * 4, FS6 / CHIME_BASE, 0.69)
	_mix(s, _glass(), 1.55, A6 / GLASS_BASE, 0.25)
	_mix(s, _glass(), 1.62, D7 / GLASS_BASE, 0.2)
	_hiss(s, 1.15, 0.9, 0.03, 0.3, 0.8)
	return _finish(s, 0.71)



func _level_up() -> PackedFloat32Array:
	var s: = Layer.new(1.4, SFX_RATE)
	var mid: = Layer.new(1.4, MID_RATE)
	_noise(mid, 0.0, 0.5, 0.22, 0.4, 0.25, Filter.BAND, 600.0, 1.8, 6000.0)
	_voice(mid, _table(&"soft"), 0.0, 0.5, A4, 0.14, 0.35, 0.1, A5)
	_mix(s, mid, 0.0, 1.0, 1.0)
	var chord: Array[float] = [A5, D6, E6, A6]
	for k in chord.size():
		_mix(s, _glass(), 0.42 + 0.05 * k, chord[k] / GLASS_BASE, 0.5 - 0.05 * k)
	_mix(s, _chime(), 0.45, D6 / CHIME_BASE, 0.4)
	return _finish(s, 0.62)



func _map_step() -> PackedFloat32Array:
	var s: = Layer.new(0.45, SFX_RATE)
	var mid: = Layer.new(0.45, MID_RATE)
	_noise(mid, 0.0, 0.28, 0.35, 0.05, 0.22, Filter.BAND, 1800.0, 0.7, 3200.0, 0.8)
	_mix(s, mid, 0.0, 1.0, 1.0)
	_strike(s, 0.2, 700.0, 0.7, WOOD_KNOCK)
	_click(s, 0.2, 0.4, 2600.0, Filter.BAND, 0.002)
	return _finish(s, 0.6)


func _promote() -> PackedFloat32Array:
	var s: = Layer.new(1.25, SFX_RATE)
	var mid: = Layer.new(1.25, MID_RATE)

	_noise(mid, 0.0, 0.4, 0.3, 0.34, 0.2, Filter.BAND, 350.0, 2.0, 5200.0)
	_voice(mid, _table(&"soft"), 0.0, 0.4, D4, 0.18, 0.3, 0.06, D6)
	_mix(s, mid, 0.0, 1.0, 1.0)
	var chord: Array[float] = [D6, FS6, A6]
	for k in chord.size():
		_mix(s, _chime(), 0.36 + 0.012 * k, chord[k] / CHIME_BASE, 0.55)
	_mix(s, _glass(), 0.4, D7 / GLASS_BASE, 0.25)
	return _finish(s, 0.7)







func _chime() -> Layer:
	if not _templates.has(&"chime"):
		var t: = Layer.new(1.6, MID_RATE)
		_strike(t, 0.0, CHIME_BASE, 1.0, CHIME_MODES)
		_click(t, 0.0, 0.1, 4500.0, Filter.BAND, 0.002)
		_fade_end(t, 0.05)
		_templates[&"chime"] = t
	return _templates[&"chime"]



func _glass() -> Layer:
	if not _templates.has(&"glass"):
		var t: = Layer.new(0.8, MID_RATE)
		_strike(t, 0.0, GLASS_BASE, 1.0, GLASS_MODES)
		_click(t, 0.0, 0.05, 6000.0, Filter.HIGH, 0.0015)
		_fade_end(t, 0.05)
		_templates[&"glass"] = t
	return _templates[&"glass"]



func _ping() -> Layer:
	if not _templates.has(&"ping"):
		var t: = Layer.new(0.5, SFX_RATE)
		_strike(t, 0.0, PING_BASE, 1.0, PING_MODES)
		_click(t, 0.0, 0.25, 4000.0, Filter.HIGH, 0.0015)
		_fade_end(t, 0.05)
		_templates[&"ping"] = t
	return _templates[&"ping"]



func _warm() -> Layer:
	if not _templates.has(&"warm"):
		var t: = Layer.new(1.8, LOW_RATE)
		_strike(t, 0.0, WARM_BASE, 1.0, WARM_MODES)
		_fade_end(t, 0.1)
		_templates[&"warm"] = t
	return _templates[&"warm"]



func _table(name: StringName) -> PackedFloat32Array:
	if not _tables.has(name):
		var harmonics: Array[float] = []
		match name:
			&"pad":
				harmonics = [1.0, 0.5, 0.3, 0.18, 0.1, 0.06, 0.03]
			&"horn":
				harmonics = [1.0, 0.6, 0.35, 0.2, 0.1, 0.05]
			&"soft":
				harmonics = [1.0, 0.25, 0.08]
			&"buzz":
				harmonics = [1.0, 0.0, 0.4, 0.0, 0.25, 0.0, 0.15, 0.0, 0.08]
		var table: = PackedFloat32Array()
		table.resize(TABLE_SIZE)
		for i in TABLE_SIZE:
			var x: = TAU * i / TABLE_SIZE
			var v: = 0.0
			for h in harmonics.size():
				v += harmonics[h] * sin(x * (h + 1))
			table[i] = v
		_scale(table, 1.0 / maxf(_peak(table), 1e-06))
		_tables[name] = table
	return _tables[name]






func _music_drone(left: Layer, right: Layer) -> void :
	var period: = DRONE_PERIOD
	var harmonic_count: = 37
	var dark: = PackedFloat32Array()
	var bright: = PackedFloat32Array()
	dark.resize(harmonic_count)
	bright.resize(harmonic_count)
	dark.fill(0.0)
	bright.fill(0.0)
	dark[1] = 0.12
	bright[1] = 0.1
	for k in range(1, 17):
		if k <= 6:
			dark[2 * k] += 1.0 / pow(k, 1.8)
		bright[2 * k] += (1.0 - k / 18.0) / pow(k, 1.25)
	for k in range(1, 13):
		if k <= 5:
			dark[3 * k] += 0.6 / pow(k, 1.8)
		bright[3 * k] += 0.6 * (1.0 - k / 14.0) / pow(k, 1.3)
	var tile_dark: = PackedFloat32Array()
	var tile_diff: = PackedFloat32Array()
	tile_dark.resize(period + 1)
	tile_diff.resize(period + 1)
	var phases: = PackedFloat32Array()
	phases.resize(harmonic_count)
	for h in harmonic_count:
		phases[h] = _rng.randf() * TAU
	for i in period:
		var x: = TAU * i / period
		var d: = 0.0
		var b: = 0.0
		for h in range(1, harmonic_count):
			var v: = sin(x * h + phases[h])
			d += dark[h] * v
			b += bright[h] * v
		tile_dark[i] = d
		tile_diff[i] = b - d
	tile_dark[period] = tile_dark[0]
	tile_diff[period] = tile_diff[0]

	var lbuf: = left.data
	var rbuf: = right.data
	var loop_n: = roundi(MUSIC_LOOP_SECONDS * left.rate)

	var tiles: = floori(float(loop_n) / period)
	var step_l: = float(tiles + 1) / tiles
	var step_r: = float(tiles - 1) / tiles
	var p: = float(period)
	var pos_l: = 0.0
	var pos_r: = p * 0.5
	var j: = 0
	var brightness: = 0.0
	var gain: = 0.0
	for i in loop_n:
		if (i & 255) == 0:
			var t: = float(i) / loop_n

			brightness = 0.12 + 0.55 * (0.5 - 0.5 * cos(TAU * 2.0 * t))
			gain = DRONE_LEVEL * (1.0 + 0.12 * sin(TAU * 3.0 * t))
		var centre: = (tile_dark[j] + brightness * tile_diff[j]) * gain
		var il: = int(pos_l)
		var a: = tile_dark[il]
		var vl: = a + (tile_dark[il + 1] - a) * (pos_l - il)
		var ir: = int(pos_r)
		var c: = tile_dark[ir]
		var vr: = c + (tile_dark[ir + 1] - c) * (pos_r - ir)
		lbuf[i] += centre + vl * gain * 0.5
		rbuf[i] += centre + vr * gain * 0.5
		j += 1
		if j == period:
			j = 0
		pos_l += step_l
		if pos_l >= p:
			pos_l -= p
		pos_r += step_r
		if pos_r >= p:
			pos_r -= p



func _music_pad(left: Layer, right: Layer) -> void :
	var table: = _table(&"pad")
	var chord_count: = floori(MUSIC_CHORDS.size() / float(MUSIC_CHORD_SIZE))
	var span: = MUSIC_LOOP_SECONDS / chord_count
	for k in chord_count:
		var notes: Array[float] = MUSIC_CHORDS.slice(k * MUSIC_CHORD_SIZE, (k + 1) * MUSIC_CHORD_SIZE)
		var start: = fposmod(span * k - 1.5, MUSIC_LOOP_SECONDS)
		_pad_tile_chord(left, right, table, notes, start, span + 3.0, 3.0, 3.5)




func _pad_tile_chord(left: Layer, right: Layer, table: PackedFloat32Array, notes: Array[float], start: float, length: float, attack: float, release: float) -> void :
	var rate: = left.rate
	var tile_n: = roundi(PAD_TILE_SECONDS * rate)
	var tile_l: = PackedFloat32Array()
	var tile_r: = PackedFloat32Array()
	tile_l.resize(tile_n)
	tile_r.resize(tile_n)
	tile_l.fill(0.0)
	tile_r.fill(0.0)
	for f: float in notes:

		var base: = roundf(f * 2.0) * 0.5
		_tile_voice(tile_l, tile_r, table, rate, base, 0.85, 0.45)
		_tile_voice(tile_l, tile_r, table, rate, base + 0.5, 0.45, 0.85)
	var lbuf: = left.data
	var rbuf: = right.data
	var from: = roundi(start * rate)
	var count: = mini(roundi(length * rate), lbuf.size() - from)
	var attack_n: = roundi(attack * rate)
	var release_n: = roundi(release * rate)
	var release_from: = count - release_n
	var j: = 0
	for n in count:
		var e: = PAD_LEVEL
		if n < attack_n:
			e *= float(n) / attack_n
		elif n > release_from:
			e *= float(count - n) / release_n
		lbuf[from + n] += tile_l[j] * e
		rbuf[from + n] += tile_r[j] * e
		j += 1
		if j == tile_n:
			j = 0


func _tile_voice(tile_l: PackedFloat32Array, tile_r: PackedFloat32Array, table: PackedFloat32Array, rate: int, freq: float, gain_l: float, gain_r: float) -> void :
	var inc: = freq * TABLE_SIZE / rate
	var offset: = _rng.randi() & TABLE_MASK
	for i in tile_l.size():
		var v: = table[(int(i * inc) + offset) & TABLE_MASK]
		tile_l[i] += v * gain_l
		tile_r[i] += v * gain_r



func _music_bells(left: Layer, right: Layer) -> void :
	var cache: = {}
	for e in range(0, MUSIC_BELLS.size(), 4):
		var time: = MUSIC_BELLS[e]
		var freq: = MUSIC_BELLS[e + 1]
		var level: = MUSIC_BELLS[e + 2] * BELL_LEVEL
		var pan: = MUSIC_BELLS[e + 3]
		if not cache.has(freq):
			var fresh: = Layer.new(3.6, MUSIC_RATE)
			_strike(fresh, 0.0, freq, 1.0, MUSIC_BELL_MODES)
			_click(fresh, 0.0, 0.05, 2500.0, Filter.LOW, 0.003)
			_fade_end(fresh, 0.3)
			cache[freq] = fresh
		var bell: Layer = cache[freq]
		_mix_pan(left, right, bell, time, level, pan)
		_mix_pan(left, right, bell, time + BELL_ECHO_DELAY, level * BELL_ECHO_LEVEL, - pan)




func _music_air(left: Layer, right: Layer) -> void :
	var rate: = left.rate
	var period: = roundi(AIR_PERIOD_SECONDS * rate)
	var air: = PackedFloat32Array()
	air.resize(period)
	for i in period:
		air[i] = _rng.randf_range(-1.0, 1.0)
	var rumble: = air.duplicate()
	_lowpass_circular(rumble, 150.0, rate)
	_lowpass_circular(air, 900.0, rate)
	for i in period:
		air[i] -= rumble[i]
	var lbuf: = left.data
	var rbuf: = right.data
	var loop_n: = roundi(MUSIC_LOOP_SECONDS * rate)
	var jl: = 0
	var jr: = period >> 1
	var gain: = 0.0
	for i in loop_n:
		if (i & 255) == 0:
			gain = AIR_LEVEL * (0.55 + 0.45 * sin(TAU * float(i) / loop_n + 1.0))
		lbuf[i] += air[jl] * gain
		rbuf[i] += air[jr] * gain
		jl += 1
		if jl == period:
			jl = 0
		jr += 1
		if jr == period:
			jr = 0



static func _fold_tail(layer: Layer, loop_n: int) -> void :
	var buf: = layer.data
	for i in range(loop_n, buf.size()):
		buf[i - loop_n] += buf[i]
	buf.resize(loop_n)




static func _lowpass_circular(buf: PackedFloat32Array, cutoff: float, rate: int) -> void :
	var a: = 1.0 - exp( - TAU * cutoff / rate)
	var s1: = 0.0
	var s2: = 0.0
	for i in buf.size():
		s1 += a * (buf[i] - s1)
		s2 += a * (s1 - s2)
	for i in buf.size():
		s1 += a * (buf[i] - s1)
		s2 += a * (s1 - s2)
		buf[i] = s2







func _mode(layer: Layer, start: float, freq: float, amp: float, decay: float) -> void :
	var rate: = layer.rate
	if freq <= 0.0 or freq >= rate * 0.45:
		return
	var buf: = layer.data
	var from: = maxi(0, roundi(start * rate))
	var to: = mini(from + _ring_samples(amp, decay, rate), buf.size())
	var w: = TAU * freq / rate
	var r: = exp( - LN_1000 / (decay * rate))
	var c1: = 2.0 * r * cos(w)
	var c2: = r * r

	var y1: = - amp * sin(w) / r
	var y2: = - amp * sin(2.0 * w) / c2
	for i in range(from, to):
		var y: = c1 * y1 - c2 * y2
		buf[i] += y
		y2 = y1
		y1 = y




func _mode_pair(layer: Layer, start: float, f1: float, a1: float, d1: float, f2: float, a2: float, d2: float) -> void :
	var rate: = layer.rate
	var limit: = rate * 0.45
	var ok1: = f1 > 0.0 and f1 < limit and a1 != 0.0 and d1 > 0.0
	var ok2: = f2 > 0.0 and f2 < limit and a2 != 0.0 and d2 > 0.0
	if not (ok1 and ok2):
		if ok1:
			_mode(layer, start, f1, a1, d1)
		elif ok2:
			_mode(layer, start, f2, a2, d2)
		return
	var buf: = layer.data
	var from: = maxi(0, roundi(start * rate))
	var end1: = mini(from + _ring_samples(a1, d1, rate), buf.size())
	var end2: = mini(from + _ring_samples(a2, d2, rate), buf.size())
	var w1: = TAU * f1 / rate
	var r1: = exp( - LN_1000 / (d1 * rate))
	var c11: = 2.0 * r1 * cos(w1)
	var c12: = r1 * r1
	var p1: = - a1 * sin(w1) / r1
	var q1: = - a1 * sin(2.0 * w1) / c12
	var w2: = TAU * f2 / rate
	var r2: = exp( - LN_1000 / (d2 * rate))
	var c21: = 2.0 * r2 * cos(w2)
	var c22: = r2 * r2
	var p2: = - a2 * sin(w2) / r2
	var q2: = - a2 * sin(2.0 * w2) / c22
	var shared: = mini(end1, end2)
	for i in range(from, shared):
		var y: = c11 * p1 - c12 * q1
		var z: = c21 * p2 - c22 * q2
		buf[i] += y + z
		q1 = p1
		p1 = y
		q2 = p2
		p2 = z

	for i in range(shared, end1):
		var y: = c11 * p1 - c12 * q1
		buf[i] += y
		q1 = p1
		p1 = y
	for i in range(shared, end2):
		var z: = c21 * p2 - c22 * q2
		buf[i] += z
		q2 = p2
		p2 = z




func _strike(layer: Layer, start: float, base: float, amp: float, modes: Array[float]) -> void :
	var m: = 0
	while m + 5 < modes.size():
		_mode_pair(layer, start, base * modes[m], amp * modes[m + 1], modes[m + 2], base * modes[m + 3], amp * modes[m + 4], modes[m + 5])
		m += 6
	if m + 2 < modes.size():
		_mode(layer, start, base * modes[m], amp * modes[m + 1], modes[m + 2])




func _bloom(layer: Layer, start: float, base: float, amp: float, modes: Array[float], attack: float) -> void :
	var rate: = layer.rate
	var from: = maxi(0, roundi(start * rate))
	var remaining: = layer.data.size() - from
	if remaining <= 0:
		return
	var temp: = Layer.new(float(remaining) / rate, rate)
	_strike(temp, 0.0, base, amp, modes)
	var out: = layer.data
	var src: = temp.data
	var env: = 0.0
	var env_k: = 1.0 - exp(-3.0 / (maxf(attack, 0.0005) * rate))
	for n in mini(src.size(), remaining):
		env += (1.0 - env) * env_k
		out[from + n] += src[n] * env





func _thump(layer: Layer, start: float, f_start: float, f_end: float, glide: float, amp: float, decay: float) -> void :
	var rate: = layer.rate
	var buf: = layer.data
	var from: = maxi(0, roundi(start * rate))
	var count: = mini(_ring_samples(amp, decay, rate), buf.size() - from)
	var sweep: = f_start - f_end
	var sweep_mul: = exp(-16.0 / (glide * rate))
	var env: = amp
	var env_mul: = exp( - LN_1000 / (decay * rate))
	var attack_n: = maxi(1, roundi(0.0015 * rate))
	var x: = 0.0
	var y: = 1.0
	var c: = 1.0
	var s: = 0.0
	for n in count:
		if (n & 15) == 0:
			var w: = TAU * (f_end + sweep) / rate
			c = cos(w)
			s = sin(w)
			sweep *= sweep_mul
		var e: = env
		if n < attack_n:
			e *= float(n) / attack_n
		buf[from + n] += x * e
		var nx: = x * c + y * s
		y = y * c - x * s
		x = nx
		env *= env_mul






func _noise(layer: Layer, start: float, length: float, amp: float, attack: float, decay: float, filter: Filter, cutoff: float, q: float = 0.707, cutoff_end: float = 0.0, grit: float = 0.0) -> void :
	var rate: = layer.rate
	var buf: = layer.data
	var noise: = _noise_table
	var from: = maxi(0, roundi(start * rate))
	var count: = mini(roundi(length * rate), buf.size() - from)
	if count <= 0:
		return
	var target: = cutoff if cutoff_end <= 0.0 else cutoff_end
	var block_glide: = pow(target / cutoff, 16.0 / count)
	var nyquist_guard: = rate * 0.45
	var k: = 1.0 / q

	var m0: = 0.0
	var m1: = 0.0
	var m2: = 0.0
	match filter:
		Filter.LOW:
			m2 = 1.0
		Filter.BAND:
			m1 = k
		Filter.HIGH:
			m0 = 1.0
			m1 = - k
			m2 = -1.0
	var attack_n: = maxi(1, roundi(attack * rate))
	var fade_from: = count - mini(count, roundi(0.003 * rate))
	var attack_step: = amp / attack_n
	var env_mul: = exp( - LN_1000 / (maxf(decay, 0.0005) * rate))
	var fade_mul: = exp( - LN_1000 / maxf(1.0, count - fade_from))
	var env: = 0.0
	var fc: = cutoff
	var a1: = 0.0
	var a2: = 0.0
	var a3: = 0.0
	var ic1: = 0.0
	var ic2: = 0.0
	var offset: = _rng.randi() & NOISE_MASK
	var grit_offset: = _rng.randi() & NOISE_MASK
	var level: = 1.0
	var level_step: = 0.0
	for n in count:
		if (n & 15) == 0:

			var g: = tan(PI * minf(fc, nyquist_guard) / rate)
			a1 = 1.0 / (1.0 + g * (g + k))
			a2 = g * a1
			a3 = g * a2
			fc *= block_glide
			if grit > 0.0:
				var next: = 1.0 - grit * absf(noise[(grit_offset + (n >> 4)) & NOISE_MASK])
				level_step = (next - level) / 16.0
		if n < attack_n:
			env += attack_step
		elif n < fade_from:
			env *= env_mul
		else:
			env *= fade_mul
		var v0: = noise[(offset + n) & NOISE_MASK]
		var v3: = v0 - ic2
		var v1: = a1 * ic1 + a2 * v3
		var v2: = ic2 + a2 * ic1 + a3 * v3
		ic1 = 2.0 * v1 - ic1
		ic2 = 2.0 * v2 - ic2
		level += level_step
		buf[from + n] += (m0 * v0 + m1 * v1 + m2 * v2) * env * level




func _hiss(layer: Layer, start: float, length: float, amp: float, attack: float, decay: float, grit: float = 0.0) -> void :
	var rate: = layer.rate
	var buf: = layer.data
	var noise: = _noise_table
	var from: = maxi(0, roundi(start * rate))
	var count: = mini(roundi(length * rate), buf.size() - from)
	if count <= 0:
		return
	var attack_n: = maxi(1, roundi(attack * rate))
	var fade_from: = count - mini(count, roundi(0.003 * rate))
	var attack_step: = amp / attack_n
	var env_mul: = exp( - LN_1000 / (maxf(decay, 0.0005) * rate))
	var fade_mul: = exp( - LN_1000 / maxf(1.0, count - fade_from))
	var env: = 0.0
	var offset: = _rng.randi() & NOISE_MASK
	var grit_offset: = _rng.randi() & NOISE_MASK
	var previous: = noise[offset]
	var level: = 1.0
	var level_step: = 0.0
	for n in count:
		if grit > 0.0 and (n & 15) == 0:
			var next: = 1.0 - grit * absf(noise[(grit_offset + (n >> 4)) & NOISE_MASK])
			level_step = (next * next - level) / 16.0
		if n < attack_n:
			env += attack_step
		elif n < fade_from:
			env *= env_mul
		else:
			env *= fade_mul
		var v: = noise[(offset + n + 1) & NOISE_MASK]
		level += level_step
		buf[from + n] += (v - previous) * env * level
		previous = v



func _click(layer: Layer, start: float, amp: float, cutoff: float, filter: Filter = Filter.HIGH, length: float = 0.002) -> void :
	_noise(layer, start, length, amp, 0.0002, length, filter, cutoff, 0.8)




func _voice(layer: Layer, table: PackedFloat32Array, start: float, length: float, freq: float, amp: float, attack: float, release: float, freq_end: float = 0.0) -> void :
	var rate: = layer.rate
	var buf: = layer.data
	var from: = maxi(0, roundi(start * rate))
	var count: = mini(roundi(length * rate), buf.size() - from)
	if count <= 0:
		return
	var inc: = freq * TABLE_SIZE / rate
	var inc_mul: = 1.0 if freq_end <= 0.0 else pow(freq_end / freq, 1.0 / count)
	var attack_n: = maxi(1, roundi(attack * rate))
	var release_n: = maxi(1, roundi(release * rate))
	var release_from: = count - release_n
	var phase: = _rng.randf() * TABLE_SIZE
	for n in count:
		var e: = amp
		if n < attack_n:
			e *= float(n) / attack_n
		elif n > release_from:
			e *= float(count - n) / release_n
		buf[from + n] += table[int(phase) & TABLE_MASK] * e
		phase += inc
		inc *= inc_mul




func _voice_pair(layer: Layer, table: PackedFloat32Array, start: float, length: float, freq: float, spread: float, amp: float, attack: float, release: float) -> void :
	var rate: = layer.rate
	var buf: = layer.data
	var from: = maxi(0, roundi(start * rate))
	var count: = mini(roundi(length * rate), buf.size() - from)
	if count <= 0:
		return
	var inc1: = freq / spread * TABLE_SIZE / rate
	var inc2: = freq * spread * TABLE_SIZE / rate
	var attack_n: = maxi(1, roundi(attack * rate))
	var release_n: = maxi(1, roundi(release * rate))
	var release_from: = count - release_n
	var phase1: = _rng.randf() * TABLE_SIZE
	var phase2: = _rng.randf() * TABLE_SIZE
	for n in count:
		var e: = amp
		if n < attack_n:
			e *= float(n) / attack_n
		elif n > release_from:
			e *= float(count - n) / release_n
		buf[from + n] += (table[int(phase1) & TABLE_MASK] + table[int(phase2) & TABLE_MASK]) * e
		phase1 += inc1
		phase2 += inc2




func _melody(layer: Layer, table: PackedFloat32Array, start: float, length: float, notes: Array[float], amp: float, attack: float, release: float) -> void :
	var rate: = layer.rate
	var buf: = layer.data
	var from: = maxi(0, roundi(start * rate))
	var count: = mini(roundi(length * rate), buf.size() - from)
	var attack_n: = maxi(1, roundi(attack * rate))
	var release_n: = maxi(1, roundi(release * rate))
	var release_from: = count - release_n
	var glide_k: = 1.0 - exp(-1.0 / (0.05 * rate))
	var scale: = float(TABLE_SIZE) / rate
	var freq: = notes[1]
	var target: = freq
	var next: = 2
	var next_n: = roundi(notes[next] * rate) if next < notes.size() else count
	var phase: = 0.0
	for n in count:
		if n >= next_n:
			target = notes[next + 1]
			next += 2
			next_n = roundi(notes[next] * rate) if next < notes.size() else count
		freq += (target - freq) * glide_k
		var e: = amp
		if n < attack_n:
			e *= float(n) / attack_n
		elif n > release_from:
			e *= float(count - n) / release_n
		buf[from + n] += table[int(phase) & TABLE_MASK] * e
		phase += freq * scale



func _pad_chord(layer: Layer, start: float, length: float, notes: Array[float], amp: float, attack: float, release: float) -> void :
	var table: = _table(&"pad")
	for f: float in notes:
		_voice_pair(layer, table, start, length, f, 1.003, amp, attack, release)




func _mix(dst: Layer, src: Layer, start: float, ratio: float, gain: float) -> void :
	if ratio == 1.0 and dst.rate % src.rate == 0:
		_mix_up(dst, src, start, roundi(float(dst.rate) / src.rate), gain)
		return
	var out: = dst.data
	var inp: = src.data
	var step: = ratio * src.rate / dst.rate
	var from: = maxi(0, roundi(start * dst.rate))
	var count: = mini(int((inp.size() - 1) / step), out.size() - from)
	if step == floorf(step):

		var stride: = int(step)
		var j: = 0
		for n in range(from, from + count):
			out[n] += inp[j] * gain
			j += stride
		return
	var pos: = 0.0
	for n in range(from, from + count):
		var i: = int(pos)
		var a: = inp[i]
		out[n] += (a + (inp[i + 1] - a) * (pos - i)) * gain
		pos += step




func _mix_up(dst: Layer, src: Layer, start: float, factor: int, gain: float) -> void :
	var out: = dst.data
	var inp: = src.data
	var from: = maxi(0, roundi(start * dst.rate))
	var k: = from
	match factor:
		1:
			for j in mini(inp.size(), out.size() - from):
				out[k] += inp[j] * gain
				k += 1
		2:
			var a: = inp[0] * gain
			for j in mini(inp.size() - 1, floori((out.size() - from) / 2.0)):
				var b: = inp[j + 1] * gain
				out[k] += a
				out[k + 1] += (a + b) * 0.5
				a = b
				k += 2
		4:
			var a: = inp[0] * gain
			for j in mini(inp.size() - 1, floori((out.size() - from) / 4.0)):
				var b: = inp[j + 1] * gain
				var d: = (b - a) * 0.25
				out[k] += a
				out[k + 1] += a + d
				out[k + 2] += a + d + d
				out[k + 3] += b - d
				a = b
				k += 4
		_:
			push_error("AudioSynth: unsupported upsampling factor %d" % factor)



func _mix_pan(left: Layer, right: Layer, src: Layer, start: float, gain: float, pan: float) -> void :
	var angle: = (clampf(pan, -1.0, 1.0) + 1.0) * PI * 0.25
	var gain_l: = gain * cos(angle)
	var gain_r: = gain * sin(angle)
	var lbuf: = left.data
	var rbuf: = right.data
	var sbuf: = src.data
	var from: = maxi(0, roundi(start * left.rate))
	var count: = mini(sbuf.size(), lbuf.size() - from)
	for n in count:
		var v: = sbuf[n]
		lbuf[from + n] += v * gain_l
		rbuf[from + n] += v * gain_r



func _saturate(layer: Layer, drive: float) -> void :
	var buf: = layer.data
	var top: = _peak(buf)
	if top <= 0.0:
		return
	var pre: = drive / top
	var post: = 1.0 / tanh(drive)
	for i in buf.size():
		buf[i] = tanh(buf[i] * pre) * post




func _finish(layer: Layer, peak: float) -> PackedFloat32Array:
	_fade_end(layer, 0.004)
	var buf: = layer.data
	var top: = _peak(buf)
	if top > 0.0:
		_scale(buf, peak / top)
	return buf


static func _fade_end(layer: Layer, seconds: float) -> void :
	var buf: = layer.data
	var n: = buf.size()
	var fade: = mini(n, roundi(seconds * layer.rate))
	for i in fade:
		buf[n - 1 - i] *= float(i) / fade



static func _ring_samples(amp: float, decay: float, rate: int) -> int:
	var level: = absf(amp)
	if level <= SILENCE or decay <= 0.0:
		return 0
	return ceili(decay * log(level / SILENCE) / LN_1000 * rate)


static func _peak(buf: PackedFloat32Array) -> float:
	var top: = 0.0
	for v in buf:
		if v > top:
			top = v
		elif - v > top:
			top = - v
	return top


static func _scale(buf: PackedFloat32Array, gain: float) -> void :
	for i in buf.size():
		buf[i] *= gain
