extends Node









const AudioSynth: = preload("res://scripts/presentation/audio_synth.gd")

const MASTER_BUS: = &"Master"
const MUSIC_BUS: = &"Music"
const SFX_BUS: = &"SFX"
const VOICE_COUNT: = 12

const MAX_BUILD_THREADS: = 6

const PITCH_VARIANCE: = 0.025

const RETRIGGER_USEC: = 30000
const MUSIC_FADE_IN_SECONDS: = 2.5

const MIN_GAIN: = 0.001

const STEP_SEMITONES: Array[int] = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]

const VARIED_SOUNDS: Array[StringName] = [
	&"ui_hover", &"ui_click", &"ui_back", &"select", &"deselect", &"move", &"enemy_move", &"land", 
	&"capture", &"shatter", &"coin", &"purchase", &"train", &"map_step", &"error", 
]


var build_msec: = 0.0

var music_msec: = 0.0

var _streams: = {}
var _base_synth: AudioSynth
var _batches: Array[Array] = []
var _batch_results: Array[Dictionary] = []
var _voices: Array[AudioStreamPlayer] = []
var _voice_started: = PackedInt64Array()
var _next_voice: = 0
var _last_played: = {}
var _warned: = {}
var _rng: = RandomNumberGenerator.new()
var _ready_done: = false

var _music_player: AudioStreamPlayer
var _music_stream: AudioStreamWAV
var _music_result: AudioStreamWAV
var _music_task: = -1
var _music_wanted: = false
var _music_gain: = 0.0
var _music_tween: Tween


func _ready() -> void :
	process_mode = Node.PROCESS_MODE_ALWAYS
	_rng.randomize()
	_setup_buses()


	_music_task = WorkerThreadPool.add_task(_build_music, false, "Sfx music synthesis")
	var started: = Time.get_ticks_usec()
	_build_effects()
	build_msec = (Time.get_ticks_usec() - started) / 1000.0
	for i in VOICE_COUNT:
		var voice: = AudioStreamPlayer.new()
		voice.bus = SFX_BUS
		add_child(voice)
		_voices.append(voice)
	_voice_started.resize(VOICE_COUNT)
	_voice_started.fill(0)
	_music_player = AudioStreamPlayer.new()
	_music_player.bus = MUSIC_BUS
	add_child(_music_player)
	_ready_done = true


func _process(_delta: float) -> void :
	if _music_task == -1:
		set_process(false)
		return
	if not WorkerThreadPool.is_task_completed(_music_task):
		return
	WorkerThreadPool.wait_for_task_completion(_music_task)
	_music_task = -1
	_music_stream = _music_result
	_music_result = null
	set_process(false)
	if _music_wanted:
		_fade_music_in()


func _exit_tree() -> void :
	if _music_task != -1:
		WorkerThreadPool.wait_for_task_completion(_music_task)
		_music_task = -1

	for voice in _voices:
		voice.stop()
		voice.stream = null
	if _music_player != null:
		_music_player.stop()
		_music_player.stream = null
	_music_stream = null
	_music_result = null
	_streams.clear()



func play(sound: StringName, pitch_scale: float = 1.0, volume_db: float = 0.0) -> void :
	var stream: = _stream_for(sound)
	if stream == null:
		return
	var pitch: = pitch_scale
	if VARIED_SOUNDS.has(sound):
		pitch *= 1.0 + _rng.randf_range( - PITCH_VARIANCE, PITCH_VARIANCE)
	_start_voice(sound, stream, pitch, volume_db)




func play_step(sound: StringName, step: int, volume_db: float = 0.0) -> void :
	var stream: = _stream_for(sound)
	if stream == null:
		return
	_start_voice("%s:%d" % [sound, step], stream, step_pitch(step), volume_db)



static func step_pitch(step: int) -> float:
	var index: = clampi(step, 0, STEP_SEMITONES.size() - 1)
	return pow(2.0, STEP_SEMITONES[index] / 12.0)




func play_music() -> void :
	_music_wanted = true
	if _music_stream != null:
		_fade_music_in()



func stop_music(fade_seconds: float = 1.0) -> void :
	_music_wanted = false
	if _music_player == null or not _music_player.playing:
		return
	_kill_music_tween()
	if fade_seconds <= 0.0:
		_music_player.stop()
		_set_music_gain(0.0)
		return
	_music_tween = create_tween()
	_music_tween.tween_method(_set_music_gain, _music_gain, 0.0, fade_seconds)
	_music_tween.tween_callback(_music_player.stop)



func set_bus_volume(bus: String, linear: float) -> void :
	var index: = AudioServer.get_bus_index(bus)
	if index < 0:
		push_warning("Sfx: unknown audio bus '%s'" % bus)
		return
	var value: = clampf(linear, 0.0, 1.0)
	AudioServer.set_bus_mute(index, value <= 0.0)
	AudioServer.set_bus_volume_db(index, linear_to_db(maxf(value, MIN_GAIN)))



func get_bus_volume(bus: String) -> float:
	var index: = AudioServer.get_bus_index(bus)
	if index < 0 or AudioServer.is_bus_mute(index):
		return 0.0
	return clampf(db_to_linear(AudioServer.get_bus_volume_db(index)), 0.0, 1.0)



func is_ready() -> bool:
	return _ready_done



func is_music_ready() -> bool:
	return _music_stream != null




func _build_effects() -> void :
	_base_synth = AudioSynth.new()
	_base_synth.prepare()
	_batches = AudioSynth.batches(clampi(OS.get_processor_count() - 1, 1, MAX_BUILD_THREADS))
	_batch_results.clear()
	for i in _batches.size():
		_batch_results.append({})
	var group: = WorkerThreadPool.add_group_task(_build_batch, _batches.size(), -1, true, "Sfx effect synthesis")
	WorkerThreadPool.wait_for_group_task_completion(group)
	for result in _batch_results:
		_streams.merge(result)
	_batches.clear()
	_batch_results.clear()
	_base_synth = null


func _build_batch(index: int) -> void :
	var synth: = AudioSynth.new(_base_synth)
	var result: = _batch_results[index]
	for sound: StringName in _batches[index]:
		result[sound] = synth.build(sound)


func _build_music() -> void :
	var started: = Time.get_ticks_usec()
	_music_result = AudioSynth.new().build_music()
	music_msec = (Time.get_ticks_usec() - started) / 1000.0


func _stream_for(sound: StringName) -> AudioStreamWAV:
	if not _ready_done:
		return null
	var stream: AudioStreamWAV = _streams.get(sound)
	if stream == null and not _warned.has(sound):
		_warned[sound] = true
		push_error("Sfx: unknown sound '%s'" % sound)
	return stream


func _start_voice(key: Variant, stream: AudioStreamWAV, pitch: float, volume_db: float) -> void :
	var now: = Time.get_ticks_usec()
	var last: int = _last_played.get(key, - RETRIGGER_USEC)
	if now - last < RETRIGGER_USEC:
		return
	_last_played[key] = now
	var index: = _pick_voice()
	var voice: = _voices[index]
	voice.stop()
	voice.stream = stream
	voice.pitch_scale = clampf(pitch, 0.1, 4.0)
	voice.volume_db = volume_db
	voice.play()
	_voice_started[index] = now



func _pick_voice() -> int:
	for offset in VOICE_COUNT:
		var index: = (_next_voice + offset) % VOICE_COUNT
		if not _voices[index].playing:
			_next_voice = (index + 1) % VOICE_COUNT
			return index
	var oldest: = 0
	for index in range(1, VOICE_COUNT):
		if _voice_started[index] < _voice_started[oldest]:
			oldest = index
	_next_voice = (oldest + 1) % VOICE_COUNT
	return oldest


func _fade_music_in() -> void :
	_kill_music_tween()
	if not _music_player.playing:
		_music_player.stream = _music_stream
		_set_music_gain(0.0)
		_music_player.play()
	var remaining: = MUSIC_FADE_IN_SECONDS * (1.0 - _music_gain)
	if remaining <= 0.0:
		return
	_music_tween = create_tween()
	_music_tween.tween_method(_set_music_gain, _music_gain, 1.0, remaining)


func _set_music_gain(gain: float) -> void :
	_music_gain = gain
	_music_player.volume_db = linear_to_db(maxf(gain, MIN_GAIN))


func _kill_music_tween() -> void :
	if _music_tween != null and _music_tween.is_valid():
		_music_tween.kill()
	_music_tween = null


func _setup_buses() -> void :
	for bus_name: StringName in [MUSIC_BUS, SFX_BUS]:
		if AudioServer.get_bus_index(bus_name) == -1:
			var index: = AudioServer.bus_count
			AudioServer.add_bus(index)
			AudioServer.set_bus_name(index, bus_name)
			AudioServer.set_bus_send(index, MASTER_BUS)
	var sfx: = AudioServer.get_bus_index(SFX_BUS)
	if not _bus_has_effect(sfx, "AudioEffectReverb"):

		var reverb: = AudioEffectReverb.new()
		reverb.room_size = 0.78
		reverb.damping = 0.55
		reverb.spread = 0.7
		reverb.hipass = 0.25
		reverb.predelay_msec = 45.0
		reverb.predelay_feedback = 0.2
		reverb.dry = 1.0
		reverb.wet = 0.12
		AudioServer.add_bus_effect(sfx, reverb)
	var music: = AudioServer.get_bus_index(MUSIC_BUS)
	if not _bus_has_effect(music, "AudioEffectReverb"):

		var hall: = AudioEffectReverb.new()
		hall.room_size = 0.85
		hall.damping = 0.6
		hall.spread = 1.0
		hall.hipass = 0.1
		hall.predelay_msec = 60.0
		hall.predelay_feedback = 0.3
		hall.dry = 0.85
		hall.wet = 0.3
		AudioServer.add_bus_effect(music, hall)
	var master: = AudioServer.get_bus_index(MASTER_BUS)
	if not _bus_has_effect(master, "AudioEffectHardLimiter") and not _bus_has_effect(master, "AudioEffectLimiter"):

		var limiter: = AudioEffectHardLimiter.new()
		limiter.ceiling_db = -0.5
		limiter.pre_gain_db = 0.0
		limiter.release = 0.12
		AudioServer.add_bus_effect(master, limiter)


static func _bus_has_effect(bus_index: int, type_name: String) -> bool:
	for i in AudioServer.get_bus_effect_count(bus_index):
		if AudioServer.get_bus_effect(bus_index, i).is_class(type_name):
			return true
	return false
