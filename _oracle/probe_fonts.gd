extends RefCounted
## Oracle probe — the text metrics the port's UI and Label3D must reproduce.
## Uses the game's own UiTheme fonts (FontVariation over the shipped variable TTFs).
##   metrics   ascent / descent / height for sizes 6..100, per font
##   chars     advance of every corpus character at the UI sizes
##   strings   width of every corpus string (get_string_size) at the UI sizes
##   outline   glyph bitmaps with and without outline_size 14 (Label3D float text)
##   labels    minimum sizes of real UiKit nodes (label / title / caption / wrap / button)

const METRIC_SIZES := [6, 100]
const UI_SIZES := [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 34, 38, 44, 52, 56, 60, 72]
const OUTLINE_SIZES := [52, 54, 56, 60, 72]
const OUTLINE_CHARS := "I+1OXP"


func _emit(entry: Dictionary) -> void:
	print("ORACLE ", JSON.stringify(entry, "", false, true))


func _fonts() -> Dictionary:
	return {
		"display": UiTheme.display_font(), "caps": UiTheme.caps_font(), "body": UiTheme.body_font(),
		"bold": UiTheme.bold_font(), "italic": UiTheme.italic_font(), "numbers": UiTheme.number_font(),
	}


func run(host: Node) -> void:
	var corpus_path: String = (get_script() as GDScript).resource_path.get_base_dir().path_join("font_corpus.json")
	var corpus: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(corpus_path))
	var strings: Array = corpus.strings
	var charset: String = corpus.charset
	var fonts := _fonts()
	_emit({"k": "corpus", "strings": strings.size(), "charset": charset})
	for name in fonts:
		var font: Font = fonts[name]
		_metrics(name, font)
		_chars(name, font, charset)
		_strings(name, font, strings)
	_outline(fonts.display)
	await _labels(host)


func _metrics(name: String, font: Font) -> void:
	var rows := []
	for size in range(METRIC_SIZES[0], METRIC_SIZES[1] + 1):
		rows.append([size, font.get_ascent(size), font.get_descent(size), font.get_height(size)])
	_emit({"k": "metrics", "font": name, "rows": rows})


func _chars(name: String, font: Font, charset: String) -> void:
	for size in UI_SIZES:
		var advances := []
		for i in charset.length():
			advances.append(font.get_char_size(charset.unicode_at(i), size).x)
		_emit({"k": "chars", "font": name, "size": size, "w": advances})


func _strings(name: String, font: Font, strings: Array) -> void:
	for size in UI_SIZES:
		var widths := []
		for s in strings:
			widths.append(font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x)
		_emit({"k": "strings", "font": name, "size": size, "w": widths})


## Glyph bitmaps straight from the text server's cache: size, offset and the alpha image as PNG.
func _outline(font: Font) -> void:
	var ts := TextServerManager.get_primary_interface()
	var rid: RID = font.get_rids()[0]
	for size in OUTLINE_SIZES:
		for outline in [0, 14]:
			var key := Vector2i(size, outline)
			for i in OUTLINE_CHARS.length():
				var code := OUTLINE_CHARS.unicode_at(i)
				var glyph := ts.font_get_glyph_index(rid, size, code, 0)
				ts.font_render_glyph(rid, key, glyph)
				var entry := {
					"k": "glyph", "size": size, "outline": outline, "char": OUTLINE_CHARS[i],
					"glyph_size": _v2(ts.font_get_glyph_size(rid, key, glyph)),
					"glyph_offset": _v2(ts.font_get_glyph_offset(rid, key, glyph)),
					"advance": _v2(ts.font_get_glyph_advance(rid, size, glyph)),
				}
				if size == 72 or size == 60:
					var index := ts.font_get_glyph_texture_idx(rid, key, glyph)
					var atlas: Image = ts.font_get_texture_image(rid, key, index)
					var uv: Rect2 = ts.font_get_glyph_uv_rect(rid, key, glyph)
					if atlas != null and uv.size.x > 0:
						var crop := atlas.get_region(Rect2i(uv.position, uv.size))
						entry.uv = [uv.position.x, uv.position.y, uv.size.x, uv.size.y]
						entry.format = atlas.get_format()
						entry.png = Marshalls.raw_to_base64(crop.save_png_to_buffer())
				_emit(entry)


func _v2(v: Vector2) -> Array:
	return [v.x, v.y]


## Real UiKit nodes under the game theme: minimum sizes and line counts the port's layout must match.
func _labels(host: Node) -> void:
	var root := Control.new()
	root.theme = UiTheme.theme()
	root.size = Vector2(1600, 900)
	host.add_child(root)
	var probe := Label.new()
	root.add_child(probe)
	_emit({"k": "theme", "label_line_spacing": probe.get_theme_constant("line_spacing"),
		"label_paragraph_spacing": probe.get_theme_constant("paragraph_spacing") if probe.has_theme_constant("paragraph_spacing") else -1,
		"default_font_size": probe.get_theme_font_size("font_size"),
		"shadow_offset": [probe.get_theme_constant("shadow_offset_x"), probe.get_theme_constant("shadow_offset_y")],
		"outline_size": probe.get_theme_constant("outline_size")})
	var samples := [
		["label", "Encounter 1 / 9", 20], ["label", "Eliminate all enemy pieces", 22], ["title", "Chainmate", 60],
		["title", "Encounter 1 / 9", 28], ["caption", "Act I  ·  The Moss Ranks", 13], ["caption", "Relics", 13],
		["flavor", "Small steps change everything.", 18], ["number", "10", 28], ["number", "1234", 22],
	]
	for sample in samples:
		var node: Label
		match sample[0]:
			"label": node = UiKit.label(sample[1], sample[2])
			"title": node = UiKit.title(sample[1], sample[2])
			"caption": node = UiKit.caption(sample[1], Palette.MUTED, sample[2])
			"flavor": node = UiKit.flavor(sample[1], sample[2])
			"number": node = UiKit.number(sample[1], sample[2])
		root.add_child(node)
		_emit({"k": "label", "kind": sample[0], "text": node.text, "size": sample[2], "min": _v2(node.get_minimum_size()), "lines": node.get_line_count()})
	var paragraphs := [
		"Forward one (two from home). Captures diagonally forward. Never retreats.",
		"Once per battle, after a capture, the capturing piece may move again. The chain is the heart of every victory.",
		"Moves like a knight or a bishop. Leaps over anything in its way and lands where it pleases.",
	]
	for text in paragraphs:
		for width in [220.0, 260.0, 300.0, 320.0, 360.0]:
			for size in [16, 18, 19]:
				var node := UiKit.wrap(text, size, Palette.MUTED, width)
				root.add_child(node)
				node.size = Vector2(width, 0)
				_emit({"k": "wrap", "text": text, "width": width, "size": size, "min": _v2(node.get_minimum_size()), "lines": node.get_line_count()})
	for text in ["Continue", "New run", "Hint (2)", "Rules", "Menu", "End turn", "Begin"]:
		var button := UiKit.button(text, Callable())
		root.add_child(button)
		var primary := UiKit.button(text, Callable(), true)
		root.add_child(primary)
		_emit({"k": "button", "text": text, "min": _v2(button.get_minimum_size()), "primary_min": _v2(primary.get_minimum_size())})
	await host.get_tree().process_frame
	root.queue_free()
