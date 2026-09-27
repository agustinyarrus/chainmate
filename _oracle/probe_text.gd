extends RefCounted
## Oracle probe — Godot's text shaping and line breaking, glyph by glyph, so the port's HarfBuzz
## layer can be compared to the original TextServerAdvanced exactly.
##   shaped   per corpus string: glyph ids, advances, x offsets, flags, clusters (6 fonts × sizes)
##   breaks   every soft/hard break opportunity (line breaks at width 1 with word bounds)
##   wraps    real Label line splits for long strings at several widths (via character bounds)

const SIZES := [13, 18, 24, 60]


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func run(host: Node) -> void:
	var corpus_path: String = (get_script() as GDScript).resource_path.get_base_dir().path_join("font_corpus.json")
	var corpus: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(corpus_path))
	var strings: Array = corpus.strings
	var fonts := {
		"display": UiTheme.display_font(), "caps": UiTheme.caps_font(), "body": UiTheme.body_font(),
		"bold": UiTheme.bold_font(), "italic": UiTheme.italic_font(), "numbers": UiTheme.number_font(),
	}
	var ts := TextServerManager.get_primary_interface()
	for name in fonts:
		var font: Font = fonts[name]
		for size in SIZES:
			var rows := []
			for s in strings:
				rows.append(_shape(ts, font, size, s))
			_emit({"k": "shaped", "font": name, "size": size, "rows": rows})
	_breaks(ts, fonts.body, strings)
	await _wraps(host, strings)


## [ids], [advance], [x_off], [flags], [start], [end] for one string.
func _shape(ts: TextServer, font: Font, size: int, text: String) -> Array:
	var line := TextLine.new()
	line.add_string(text, font, size)
	var rid := line.get_rid()
	var glyphs: Array = ts.shaped_text_get_glyphs(rid)
	var ids := []
	var advances := []
	var offsets := []
	var flags := []
	var starts := []
	var ends := []
	for g: Dictionary in glyphs:
		ids.append(g.index)
		advances.append(g.advance)
		offsets.append(g.offset.x)
		flags.append(g.flags)
		starts.append(g.start)
		ends.append(g.end)
	return [ids, advances, offsets, flags, starts, ends, ts.shaped_text_get_width(rid)]


## Break opportunities: with width 1 every soft break ends a line (edge spaces trimmed).
func _breaks(ts: TextServer, font: Font, strings: Array) -> void:
	var flags := TextServer.BREAK_MANDATORY | TextServer.BREAK_WORD_BOUND | TextServer.BREAK_TRIM_START_EDGE_SPACES | TextServer.BREAK_TRIM_END_EDGE_SPACES
	var rows := []
	for s in strings:
		var line := TextParagraph.new()
		line.add_string(s, font, 18)
		var rid := line.get_rid()
		rows.append(Array(ts.shaped_text_get_line_breaks(rid, 1.0, 0, flags)))
	_emit({"k": "breaks", "font": "body", "size": 18, "flags": flags, "rows": rows})


## Real Label nodes (theme fonts, WORD_SMART) — first character of each line, via get_character_bounds.
func _wraps(host: Node, strings: Array) -> void:
	var root := Control.new()
	root.theme = UiTheme.theme()
	host.add_child(root)
	var long_strings := strings.filter(func(s: String) -> bool: return s.length() > 40)
	for width in [200.0, 280.0, 360.0]:
		var rows := []
		for s: String in long_strings:
			var label := UiKit.wrap(s, 18, Palette.MUTED, width)
			root.add_child(label)
			label.size = Vector2(width, 0)
			rows.append([label.get_line_count(), label.get_minimum_size().y])
			label.queue_free()
		_emit({"k": "wraps", "size": 18, "width": width, "strings": long_strings, "rows": rows})
	await host.get_tree().process_frame
	root.queue_free()
