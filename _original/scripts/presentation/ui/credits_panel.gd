class_name CreditsPanel
extends Modal



const FONT_NOTICES: Array[String] = ["res://assets/fonts/Cinzel-OFL.txt", "res://assets/fonts/CormorantGaramond-OFL.txt"]
const WIDTH: = 700.0


func _init() -> void :
	super ("Credits", 800.0, 0.6)


func _ready() -> void :
	super ()
	var scroll: = ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(730, 480)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	content.add_child(scroll)
	var column: = UiKit.vbox(12)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(column)

	column.add_child(UiKit.wrap("Chainmate is made with the Godot Engine. Its pieces, arenas, relics, music and sounds are generated in code.", 20, Palette.INK, WIDTH))

	column.add_child(UiKit.title("Godot Engine", 22, Palette.GOLD_BRIGHT))
	column.add_child(UiKit.wrap("This game uses Godot Engine, available under the following licence:", 18, Palette.MUTED, WIDTH))
	column.add_child(_plain(Engine.get_license_text()))

	column.add_child(UiKit.title("Fonts", 22, Palette.GOLD_BRIGHT))
	column.add_child(UiKit.wrap("Cinzel and Cormorant Garamond are used under the SIL Open Font Licence 1.1.", 18, Palette.MUTED, WIDTH))
	for path in FONT_NOTICES:
		var notice: = FileAccess.get_file_as_string(path)
		assert (notice != "", "Missing font licence notice: %s" % path)
		column.add_child(_plain(notice))

	column.add_child(UiKit.title("Godot's third-party components", 22, Palette.GOLD_BRIGHT))
	var components: = PackedStringArray()
	for component: Dictionary in Engine.get_copyright_info():
		components.append(str(component.name))
		for part: Dictionary in component.parts:
			for line in part.copyright:
				components.append("    © " + str(line))
			components.append("    Licence: " + str(part.license))
	column.add_child(_plain("\n".join(components)))
	var licences: = Engine.get_license_info()
	for name in licences:
		column.add_child(UiKit.title(str(name), 18, Palette.INK))
		column.add_child(_plain(str(licences[name])))

	var done: = UiKit.button("Close", close, true, 140)
	var buttons: Array[Button] = [done]
	add_footer(buttons)
	done.grab_focus.call_deferred()



func _plain(text: String) -> Label:
	var label: = UiKit.wrap(text.strip_edges(), 15, Palette.MUTED, WIDTH)
	return label
