extends RefCounted
## Oracle probe — what the engine's mixer puts out for scripted playbacks of the game's own streams.
## Every case is a list of timed events (start a voice, stop it, start the music, move a volume) run
## against a clean effect state; the frames are tapped at the very end of the Master bus effects,
## after the resampler, the per-bus reverbs, the bus volumes of Music and SFX, and the limiter.
##
##   timing   how long the original took to synthesise its effects and its music
##   mix      per case: the captured frames (float32 stereo, DEFLATE + base64 "blob" parts) and, per
##            event, the exact index of the first frame it can affect
##
## Exact event positions: events are applied while the audio thread is locked out, and the frames
## mixed so far are counted inside that same lock — so an event belongs to the mix step that produces
## the frame with that index. The recording starts with the first event of a case.
##
## The tap never stops: a capture effect is processed even on a bus the engine has switched off for
## being silent, and then it records whatever the bus buffer was left holding. The port's test taps
## its own mixer the same way, so those frames are compared like any other — they tell exactly when
## each bus went to sleep. "Quiet" is read from the peak meters, which a sleeping bus pins to -200 dB.

const BLOB_PART := 180000
## Peak meters at or under this level on every bus: nothing is sounding (a sleeping bus reads -200).
const QUIET_PEAK_DB := -199.0
## Quiet time required before a case; longer than the engine's channel_disable_time (2 s), so that
## even a bus that was silent but still awake has gone to sleep.
const SETTLE_SECONDS := 2.4
const DEADLINE_SECONDS := 18.0
const BUSES := ["Master", "Music", "SFX"]
## Event times below zero wait for that long a quiet instead: the SFX bus has gone to sleep (but the
## Master bus, which sleeps two seconds later, has not), or every bus has.
const SFX_ASLEEP := -0.3
const ALL_ASLEEP := -2.6

## `seconds` is how long the recording goes on after the last event; 0 records until the buses have
## been quiet for a moment. Events: [time, kind, arguments]
##   play  sound, pitch, volume_db      stop  index of the play event whose voice is stopped
##   music from_position, volume_db     music_db volume_db     music_stop
##   bus   name, linear volume (through Sfx.set_bus_volume)
const CASES := [
	{"id": "check", "seconds": 2.6, "events": [[0.0, "play", "check", 1.0, 0.0]]},
	{"id": "coin_pitched", "seconds": 1.6, "events": [[0.0, "play", "coin", 1.335, -3.0]]},
	{"id": "hover_until_quiet", "seconds": 0.0, "events": [[0.0, "play", "ui_hover", 0.75, 0.0]]},
	{"id": "capture_burst", "seconds": 3.6, "events": [
		[0.0, "play", "capture", 1.0, 0.0], [0.0, "play", "shatter", 1.0, -6.0],
		[0.0, "play", "victory", 1.0, 6.0], [0.0, "play", "encounter_start", 0.9, 3.0]]},
	{"id": "sfx_volume", "seconds": 1.8, "events": [
		[0.0, "bus", "SFX", 0.85], [0.0, "play", "promote", 1.12, 0.0], [0.0, "play", "land", 1.0, 0.0]]},
	{"id": "pitch_extremes", "seconds": 1.6, "events": [
		[0.0, "play", "chain_step", 4.0, -3.0], [0.0, "play", "ui_click", 0.1, 0.0], [0.0, "play", "coin", 1.4983070768766815, -2.0]]},
	{"id": "late_start", "seconds": 1.5, "events": [[0.0, "play", "check", 1.0, 0.0], [0.7, "play", "coin", 1.0, 0.0]]},
	{"id": "stop_fade", "seconds": 1.1, "events": [[0.0, "play", "victory", 1.0, 0.0], [0.5, "stop", 0]]},
	{"id": "steal", "seconds": 1.9, "events": [
		[0.0, "play", "victory", 1.0, -12.0], [0.0, "play", "encounter_start", 1.0, -12.0],
		[0.0, "play", "encounter_won", 1.0, -12.0], [0.0, "play", "lost", 1.0, -12.0],
		[0.0, "play", "check", 1.0, -12.0], [0.0, "play", "level_up", 1.0, -12.0],
		[0.0, "play", "chain_step", 1.0, -12.0], [0.0, "play", "promote", 1.0, -12.0],
		[0.0, "play", "purchase", 1.0, -12.0], [0.0, "play", "train", 1.0, -12.0],
		[0.0, "play", "relic_trigger", 1.0, -12.0], [0.0, "play", "shatter", 1.0, -12.0],
		[0.4, "play", "coin", 1.0, -12.0], [0.45, "play", "select", 1.0, -12.0]]},
	{"id": "sfx_asleep_restart", "seconds": 0.0, "events": [
		[0.0, "play", "ui_click", 1.0, 0.0], [SFX_ASLEEP, "play", "ui_back", 1.0, 0.0]]},
	{"id": "all_asleep_restart", "seconds": 1.0, "events": [
		[0.0, "play", "ui_hover", 1.0, 0.0], [ALL_ASLEEP, "play", "select", 1.0, 0.0]]},
	{"id": "bus_mute", "seconds": 1.0, "events": [[0.0, "bus", "SFX", 0.0], [0.0, "play", "check", 1.0, 0.0]]},
	{"id": "music", "seconds": 2.4, "events": [[0.0, "music", 0.0, 0.0]]},
	{"id": "music_seam", "seconds": 2.4, "events": [[0.0, "music", 31.0, 0.0]]},
	{"id": "music_gain", "seconds": 1.3, "events": [
		[0.0, "music", 12.0, -12.0], [0.6, "music_db", 0.0], [1.2, "music_stop"]]},
	{"id": "music_and_sfx", "seconds": 1.0, "events": [
		[0.0, "music", 4.0, -2.0], [0.0, "play", "check", 1.0, 0.0],
		[0.3, "play", "coin", 1.0, 0.0], [0.9, "bus", "Music", 0.55], [1.4, "bus", "Master", 0.8]]},
]

var _capture: AudioEffectCapture
var _frames := PackedVector2Array()
## Voice index taken by each "play" event of the running case.
var _plays: Array[int] = []


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func _blob(id: String, bytes: PackedByteArray) -> void:
	var text := Marshalls.raw_to_base64(bytes.compress(FileAccess.COMPRESSION_DEFLATE))
	var parts := maxi(1, ceili(text.length() / float(BLOB_PART)))
	for i in parts:
		_emit({"k": "blob", "id": id, "part": i, "of": parts, "bytes": bytes.size(), "data": text.substr(i * BLOB_PART, BLOB_PART)})


func run(host: Node) -> void:
	# The Sfx autoload comes to life after this probe's first await; its music a while later.
	await host.get_tree().process_frame
	while not (Sfx.is_ready() and Sfx.is_music_ready()):
		await host.get_tree().process_frame
	_emit({"k": "timing", "build_msec": Sfx.build_msec, "music_msec": Sfx.music_msec, "processors": OS.get_processor_count(),
		"mix_rate": AudioServer.get_mix_rate(), "driver": AudioServer.get_driver_name(), "output_latency": AudioServer.get_output_latency()})
	for case: Dictionary in CASES:
		await _run_case(host, case)
	await _settle(host)
	for bus: String in BUSES:
		Sfx.set_bus_volume(bus, 1.0)


func _run_case(host: Node, case: Dictionary) -> void:
	await _settle(host)
	for bus: String in BUSES:
		Sfx.set_bus_volume(bus, 1.0)
	_reset_effects()
	_frames = PackedVector2Array()
	_plays.clear()
	var events: Array = case.events
	var fired := []
	var next := 0
	var next_voice: int = Sfx._next_voice
	var tail := int(float(case.seconds) * AudioServer.get_mix_rate())
	## Frames the recording must reach: known once the last event has been placed.
	var wanted := 0
	var started := Time.get_ticks_msec()
	var busy_at := started
	var deadline := started + int(DEADLINE_SECONDS * 1000.0)
	while Time.get_ticks_msec() < deadline:
		var now := Time.get_ticks_msec()
		if not _is_quiet():
			busy_at = now
		var quiet_seconds := (now - busy_at) / 1000.0
		if next < events.size() and _is_due(events[next][0], (now - started) / 1000.0, quiet_seconds):
			AudioServer.lock()
			if next == 0:
				# The recording starts here: what the tap held so far came from sleeping buses.
				_capture.clear_buffer()
			else:
				_drain()
			var at := _frames.size()
			var time: float = events[next][0]
			while next < events.size() and events[next][0] == time:
				fired.append(_fire(String(case.id), events[next], at, now - started))
				next += 1
			AudioServer.unlock()
			wanted = at + tail
			# The meters still show the silence from before the event: start counting again.
			busy_at = Time.get_ticks_msec()
			quiet_seconds = 0.0
		elif next > 0:
			_drain()
		if next >= events.size():
			if tail > 0 and _frames.size() >= wanted:
				break
			if tail == 0 and quiet_seconds >= -SFX_ASLEEP:
				break
		await host.get_tree().process_frame
	if tail > 0:
		_frames.resize(mini(_frames.size(), wanted))
	var floats := PackedFloat32Array()
	floats.resize(_frames.size() * 2)
	for i in _frames.size():
		floats[2 * i] = _frames[i].x
		floats[2 * i + 1] = _frames[i].y
	_blob("mix_" + case.id, floats.to_byte_array())
	_emit({"k": "mix", "id": case.id, "frames": _frames.size(), "wanted": wanted if tail > 0 else 0, "mix_rate": AudioServer.get_mix_rate(),
		"f32": "mix_" + case.id, "next_voice": next_voice, "complete": next >= events.size(), "events": fired})


func _is_due(time: float, elapsed: float, quiet_seconds: float) -> bool:
	if time < 0.0:
		return quiet_seconds >= -time
	return elapsed >= time


## Applies one event; `at` is the index of the first captured frame it can affect.
func _fire(case_id: String, event: Array, at: int, msec: int) -> Dictionary:
	var row := {"at": at, "msec": msec, "event": event}
	match String(event[1]):
		"play":
			var sound := StringName(event[2])
			Sfx._start_voice("%s/%s#%d" % [case_id, sound, _plays.size()], Sfx._streams[sound], event[3], event[4])
			var voice: int = (Sfx._next_voice + Sfx.VOICE_COUNT - 1) % Sfx.VOICE_COUNT
			_plays.append(voice)
			row["voice"] = voice
			row["pitch_scale"] = Sfx._voices[voice].pitch_scale
			row["volume_db"] = Sfx._voices[voice].volume_db
		"stop":
			Sfx._voices[_plays[int(event[2])]].stop()
			row["voice"] = _plays[int(event[2])]
		"music":
			Sfx._music_player.stream = Sfx._music_stream
			Sfx._music_player.volume_db = event[3]
			Sfx._music_player.play(event[2])
			row["volume_db"] = Sfx._music_player.volume_db
		"music_db":
			Sfx._music_player.volume_db = event[2]
			row["volume_db"] = Sfx._music_player.volume_db
		"music_stop":
			Sfx._music_player.stop()
		"bus":
			Sfx.set_bus_volume(event[2], event[3])
			var index := AudioServer.get_bus_index(event[2])
			row["volume_db"] = AudioServer.get_bus_volume_db(index)
			row["mute"] = AudioServer.is_bus_mute(index)
			row["read_back"] = Sfx.get_bus_volume(event[2])
	return row


## Moves what the tap has received into _frames.
func _drain() -> void:
	var available := _capture.get_frames_available()
	if available > 0:
		_frames.append_array(_capture.get_buffer(available))


## True while no bus shows any level: they are asleep, or awake and carrying pure silence.
func _is_quiet() -> bool:
	for bus in AudioServer.bus_count:
		for channel in AudioServer.get_bus_channels(bus):
			if AudioServer.get_bus_peak_volume_left_db(bus, channel) > QUIET_PEAK_DB:
				return false
			if AudioServer.get_bus_peak_volume_right_db(bus, channel) > QUIET_PEAK_DB:
				return false
	return true


## Fresh instances of every bus effect (same parameters), and the capture tap at the end of Master.
func _reset_effects() -> void:
	for i in AudioServer.bus_count:
		var kept: Array[AudioEffect] = []
		for e in AudioServer.get_bus_effect_count(i):
			var effect := AudioServer.get_bus_effect(i, e)
			if not effect is AudioEffectCapture:
				kept.append(effect.duplicate())
		while AudioServer.get_bus_effect_count(i) > 0:
			AudioServer.remove_bus_effect(i, 0)
		for effect in kept:
			AudioServer.add_bus_effect(i, effect)
	_capture = AudioEffectCapture.new()
	_capture.buffer_length = 10.0
	AudioServer.add_bus_effect(0, _capture)


## Silences everything and waits until every bus has been quiet long enough to be asleep.
func _settle(host: Node) -> void:
	Sfx.stop_music(0.0)
	Sfx._music_player.stop()
	for voice in Sfx._voices:
		voice.stop()
	var now := Time.get_ticks_msec()
	var deadline := now + int(DEADLINE_SECONDS * 1000.0)
	var until := now + int(SETTLE_SECONDS * 1000.0)
	while Time.get_ticks_msec() < mini(until, deadline):
		await host.get_tree().process_frame
		if not _is_quiet():
			until = Time.get_ticks_msec() + int(SETTLE_SECONDS * 1000.0)
		if _capture != null:
			_capture.clear_buffer()
