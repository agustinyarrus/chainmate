extends RefCounted
## Oracle probe — everything the port's synthesiser must reproduce, produced by the original's own code:
##   hash      hash(&"name") of every sound and of "music" (the synthesiser's seeds)
##   table     the four wavetables and the noise table
##   template  the four cached instrument layers (chime, glass, ping, warm)
##   sound     per effect: the rendered float32 samples and the AudioStreamWAV built from them
##   music     both channels of the loop and the looping AudioStreamWAV
##   batches   how the sounds are split between 1 to 6 build threads
##   libm      what the original's C library answers for sin, cos, tan, exp, log, tanh and pow on
##             seeded arguments: the only arithmetic of the synthesiser that is not plain IEEE-754
##   sfx       the Sfx autoload's constants and step pitches
##   buses     the bus layout and every effect parameter, read back from AudioServer
## What the mixer does with these streams is probe_audio_mix.gd.
## Large buffers travel as DEFLATE + base64, split in parts ("blob" entries) the reader joins by id.

const AudioSynth := preload("res://scripts/presentation/audio_synth.gd")

const BLOB_PART := 180000
const LIBM_SEED := 9241
const LIBM_SAMPLES := 4000
## randf() carries 24 bits; a second draw scaled by this fills the rest of the double.
const LOW_BITS := 1.0 / 16777216.0


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func _blob(id: String, bytes: PackedByteArray) -> void:
	var text := Marshalls.raw_to_base64(bytes.compress(FileAccess.COMPRESSION_DEFLATE))
	var parts := maxi(1, ceili(text.length() / float(BLOB_PART)))
	for i in parts:
		_emit({"k": "blob", "id": id, "part": i, "of": parts, "bytes": bytes.size(), "data": text.substr(i * BLOB_PART, BLOB_PART)})


func _wav(id: String, wav: AudioStreamWAV) -> Dictionary:
	_blob(id, wav.data)
	return {"blob": id, "format": wav.format, "mix_rate": wav.mix_rate, "stereo": wav.stereo,
		"loop_mode": wav.loop_mode, "loop_begin": wav.loop_begin, "loop_end": wav.loop_end, "bytes": wav.data.size(), "length": wav.get_length()}


func run(host: Node) -> void:
	_hashes()
	var base := AudioSynth.new()
	base.prepare()
	_tables(base)
	_templates(base)
	var synth := AudioSynth.new(base)
	for sound: StringName in AudioSynth.SOUND_NAMES:
		var samples := synth.render(sound)
		_blob("sound_f32_" + sound, samples.to_byte_array())
		_emit({"k": "sound", "name": String(sound), "samples": samples.size(), "rate": AudioSynth.SFX_RATE,
			"f32": "sound_f32_" + sound, "wav": _wav("sound_wav_" + sound, AudioSynth.to_wav(samples, AudioSynth.SFX_RATE))})
	var channels := AudioSynth.new().render_music()
	_blob("music_f32_left", channels[0].to_byte_array())
	_blob("music_f32_right", channels[1].to_byte_array())
	_emit({"k": "music", "samples": channels[0].size(), "rate": AudioSynth.MUSIC_RATE, "left": "music_f32_left", "right": "music_f32_right",
		"wav": _wav("music_wav", AudioSynth.to_looping_wav(channels[0], channels[1], AudioSynth.MUSIC_RATE))})
	_emit({"k": "batches", "threads": [1, 2, 3, 4, 5, 6].map(func(n: int) -> Array: return AudioSynth.batches(n))})
	_libm()

	# The Sfx autoload and the main scene come to life after this probe's first await.
	for i in 4:
		await host.get_tree().process_frame
	Sfx.stop_music(0.0)
	_sfx_tables()
	_buses()


func _hashes() -> void:
	var rows := {}
	for sound: StringName in AudioSynth.SOUND_NAMES:
		rows[String(sound)] = hash(sound)
	rows["music"] = hash(&"music")
	_emit({"k": "hash", "rows": rows})


func _tables(synth: AudioSynth) -> void:
	for name: StringName in [&"pad", &"horn", &"soft", &"buzz"]:
		var table: PackedFloat32Array = synth._table(name)
		_blob("table_" + name, table.to_byte_array())
		_emit({"k": "table", "name": String(name), "samples": table.size(), "f32": "table_" + name})
	var noise: PackedFloat32Array = synth._noise_table
	_blob("noise", noise.to_byte_array())
	_emit({"k": "noise", "samples": noise.size(), "f32": "noise"})


func _templates(synth: AudioSynth) -> void:
	for name: StringName in [&"chime", &"glass", &"ping", &"warm"]:
		var layer = synth._templates[name]
		_blob("template_" + name, layer.data.to_byte_array())
		_emit({"k": "template", "name": String(name), "samples": layer.data.size(), "rate": layer.rate, "f32": "template_" + name})


## Arguments are drawn from one seeded stream (the port draws the same ones) over the ranges the
## synthesiser uses; values travel as raw doubles, so the comparison is bit for bit.
func _libm() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = LIBM_SEED
	var ranges := {
		"sin": [0.0, 3.2], "cos": [0.0, 3.2], "tan": [0.0, 1.45], "exp": [-18.0, 0.0],
		"log": [0.0, 12.0], "tanh": [-3.0, 3.0],
	}
	for fn: String in ranges:
		var args := PackedFloat64Array()
		var values := PackedFloat64Array()
		var low: float = ranges[fn][0]
		var high: float = ranges[fn][1]
		for i in LIBM_SAMPLES:
			var x := low + (high - low) * (rng.randf() + rng.randf() * LOW_BITS)
			args.append(x)
			values.append(_call(fn, x))
		_blob("libm_args_" + fn, args.to_byte_array())
		_blob("libm_values_" + fn, values.to_byte_array())
		_emit({"k": "libm", "fn": fn, "samples": LIBM_SAMPLES, "args": "libm_args_" + fn, "values": "libm_values_" + fn})

	# Small decay exponents, as the envelopes compute them: exp(−6.9 / (seconds · rate)).
	var decay_args := PackedFloat64Array()
	var decay_values := PackedFloat64Array()
	for i in LIBM_SAMPLES:
		var x := -6.907755278982137 / ((0.004 + 3.0 * rng.randf()) * 44100.0)
		decay_args.append(x)
		decay_values.append(exp(x))
	_blob("libm_args_exp_decay", decay_args.to_byte_array())
	_blob("libm_values_exp_decay", decay_values.to_byte_array())
	_emit({"k": "libm", "fn": "exp", "samples": LIBM_SAMPLES, "args": "libm_args_exp_decay", "values": "libm_values_exp_decay", "set": "decay"})

	# Multiples of pi, where the sine is all rounding: what the wavetables hold at their midpoint.
	var pi_args := PackedFloat64Array()
	var pi_sin := PackedFloat64Array()
	var pi_cos := PackedFloat64Array()
	for k in range(1, 40):
		var x := (TAU * 1024.0) / 2048.0 * k
		pi_args.append(x)
		pi_sin.append(sin(x))
		pi_cos.append(cos(x * 0.5))
	_blob("libm_args_pi", pi_args.to_byte_array())
	_blob("libm_values_pi_sin", pi_sin.to_byte_array())
	_blob("libm_values_pi_cos_half", pi_cos.to_byte_array())
	_emit({"k": "libm_pi", "samples": pi_args.size(), "args": "libm_args_pi", "sin": "libm_values_pi_sin", "cos_half": "libm_values_pi_cos_half"})

	# pow(base, exponent), the two shapes the synthesiser uses: glides and harmonic roll-offs.
	var bases := PackedFloat64Array()
	var exponents := PackedFloat64Array()
	var powers := PackedFloat64Array()
	for i in LIBM_SAMPLES:
		var b := 0.05 + 20.0 * (rng.randf() + rng.randf() * LOW_BITS)
		var e := -2.0 + 4.0 * (rng.randf() + rng.randf() * LOW_BITS)
		if i % 4 == 0:
			e = 16.0 / float(1 + rng.randi() % 60000)
		bases.append(b)
		exponents.append(e)
		powers.append(pow(b, e))
	_blob("libm_args_pow_base", bases.to_byte_array())
	_blob("libm_args_pow_exponent", exponents.to_byte_array())
	_blob("libm_values_pow", powers.to_byte_array())
	_emit({"k": "libm_pow", "samples": LIBM_SAMPLES, "bases": "libm_args_pow_base", "exponents": "libm_args_pow_exponent", "values": "libm_values_pow"})


func _call(fn: String, x: float) -> float:
	match fn:
		"sin":
			return sin(x)
		"cos":
			return cos(x)
		"tan":
			return tan(x)
		"exp":
			return exp(x)
		"log":
			return log(x + 0.0001)
		"tanh":
			return tanh(x)
	return NAN


func _sfx_tables() -> void:
	var steps := []
	for step in range(-2, 15):
		steps.append([step, Sfx.step_pitch(step)])
	_emit({"k": "sfx", "voice_count": Sfx.VOICE_COUNT, "pitch_variance": Sfx.PITCH_VARIANCE, "retrigger_usec": Sfx.RETRIGGER_USEC,
		"music_fade_in_seconds": Sfx.MUSIC_FADE_IN_SECONDS, "min_gain": Sfx.MIN_GAIN, "step_semitones": Sfx.STEP_SEMITONES,
		"varied_sounds": Sfx.VARIED_SOUNDS.map(func(s: StringName) -> String: return String(s)), "step_pitch": steps,
		"streams": Sfx._streams.keys().map(func(s: StringName) -> String: return String(s)),
		"voice_bus": String(Sfx._voices[0].bus), "music_bus": String(Sfx._music_player.bus),
		"db": [[1.0, linear_to_db(1.0)], [0.85, linear_to_db(0.85)], [0.55, linear_to_db(0.55)], [0.8, linear_to_db(0.8)], [0.001, linear_to_db(0.001)], [0.5, linear_to_db(0.5)]]})


func _buses() -> void:
	var rows := []
	for i in AudioServer.bus_count:
		var effects := []
		for e in AudioServer.get_bus_effect_count(i):
			var effect := AudioServer.get_bus_effect(i, e)
			var values := {}
			for property in effect.get_property_list():
				if (int(property.usage) & PROPERTY_USAGE_STORAGE) != 0 and property.type == TYPE_FLOAT:
					values[property.name] = effect.get(property.name)
			effects.append({"class": effect.get_class(), "enabled": AudioServer.is_bus_effect_enabled(i, e), "values": values})
		rows.append({"name": AudioServer.get_bus_name(i), "send": String(AudioServer.get_bus_send(i)), "volume_db": AudioServer.get_bus_volume_db(i),
			"mute": AudioServer.is_bus_mute(i), "solo": AudioServer.is_bus_solo(i), "bypass": AudioServer.is_bus_bypassing_effects(i),
			"channels": AudioServer.get_bus_channels(i), "effects": effects})
	_emit({"k": "buses", "mix_rate": AudioServer.get_mix_rate(), "speaker_mode": AudioServer.get_speaker_mode(), "driver": AudioServer.get_driver_name(),
		"playback_speed_scale": AudioServer.playback_speed_scale, "rows": rows})
