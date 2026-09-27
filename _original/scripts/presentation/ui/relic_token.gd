class_name RelicToken
extends Control



signal activated(id: String)

var relic_id: = ""
var side: = 56.0
var interactive: = false
var selected: = false:
	set(value):
		selected = value
		queue_redraw()
var _pulse: = 0.0
var _hover: = false


static func make(id: String, size: = 56.0, clickable: = false) -> RelicToken:
	var token: = RelicToken.new()
	token.relic_id = id
	token.side = size
	token.interactive = clickable
	token.custom_minimum_size = Vector2(size, size)
	token.mouse_filter = Control.MOUSE_FILTER_STOP if id != "" else Control.MOUSE_FILTER_IGNORE
	token.tooltip_text = " " if id != "" else ""
	return token


func _ready() -> void :
	mouse_entered.connect(_set_hover.bind(true))
	mouse_exited.connect(_set_hover.bind(false))
	if interactive:
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func pulse() -> void :
	var tween: = create_tween()
	tween.tween_method(_set_pulse, 1.0, 0.0, 0.8).set_ease(Tween.EASE_OUT)


func _set_pulse(value: float) -> void :
	_pulse = value
	queue_redraw()


func _set_hover(on: bool) -> void :
	_hover = on
	queue_redraw()


func _gui_input(event: InputEvent) -> void :
	if interactive and event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		activated.emit(relic_id)


func _draw() -> void :
	var rect: = Rect2(Vector2.ZERO, size).grow(-1.0)
	if relic_id == "":
		draw_rect(rect, Color(0.05, 0.07, 0.11, 0.55))
		draw_rect(rect, Color(1, 1, 1, 0.1), false, 1.0)
		return
	var info: = Relics.info(relic_id)
	var rarity: Color = Palette.RARITY_COLORS[str(info.rarity)]
	if _pulse > 0.0:
		draw_rect(rect.grow(6.0 * _pulse), Color(Palette.ACCENT, 0.35 * _pulse))
	draw_rect(rect, Color(0.06, 0.085, 0.13, 0.96))
	draw_rect(rect.grow(-3.0), Color(0.09, 0.12, 0.18, 0.9))
	var edge: = Palette.ACCENT if (selected or _hover or _pulse > 0.0) else Color(rarity, 0.55)
	draw_rect(rect, edge, false, 1.5 if (selected or _hover) else 1.0)
	Icons.draw(self, str(info.icon), size * 0.5, minf(size.x, size.y) * 0.34 * (1.0 + _pulse * 0.1))


func _make_custom_tooltip(_for_text: String) -> Object:
	return RelicToken.describe(relic_id)



static func describe(id: String, width: = 300.0) -> Control:
	var info: = Relics.info(id)
	var box: = UiKit.vbox(4)
	var header: = UiKit.hbox(10)
	header.add_child(UiKit.title(str(info.name), 20, Palette.INK))
	header.add_child(UiKit.caption(str(info.rarity), Palette.RARITY_COLORS[str(info.rarity)], 11))
	box.add_child(header)
	box.add_child(UiKit.wrap(str(info.desc), 18, Palette.INK, width))
	box.add_child(UiKit.flavor(str(info.flavor), 17))
	return box
