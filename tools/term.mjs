/**
 * Terminal look shared by every tool in this repo: pastel truecolour on black, a live spinner for
 * anything slower than a blink, and a rounded summary card at the end. One module, zero copy-paste.
 */

const ESC = '\x1b[';
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${ESC}38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
};
const RESET = `${ESC}0m`;

/** Tokyo Night / Catppuccin pastels. */
export const PALETTE = {
  blue: '#7aa2f7',
  green: '#9ece6a',
  red: '#f7768e',
  amber: '#e0af68',
  mauve: '#bb9af7',
  teal: '#8fd6cc',
  dim: '#565f89',
  ink: '#c0caf5',
};

const colour = process.stdout.isTTY !== false && !process.env.NO_COLOR;
export const paint = Object.fromEntries(
  Object.entries(PALETTE).map(([name, hex]) => [name, (text) => (colour ? `${rgb(hex)}${text}${RESET}` : String(text))]),
);

const visibleLength = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, '').length;

/** Rounded card: title on the top edge, one row per entry (cells joined by two spaces). */
export function card(title, rows, footer = '') {
  const lines = rows.map((cells) => (Array.isArray(cells) ? cells.filter((c) => c !== '').join('  ') : String(cells)));
  const width = Math.max(visibleLength(title) + 6, ...lines.map(visibleLength), visibleLength(footer)) + 2;
  const edge = (s) => paint.dim(s);
  console.log('');
  console.log(edge('  ╭─ ') + paint.mauve(title) + edge(' ' + '─'.repeat(Math.max(1, width - visibleLength(title) - 3)) + '╮'));
  for (const line of lines) console.log(edge('  │ ') + line + ' '.repeat(Math.max(0, width - visibleLength(line) - 1)) + edge('│'));
  if (footer) {
    console.log(edge('  ├' + '─'.repeat(width + 1) + '┤'));
    console.log(edge('  │ ') + footer + ' '.repeat(Math.max(0, width - visibleLength(footer) - 1)) + edge('│'));
  }
  console.log(edge('  ╰' + '─'.repeat(width + 1) + '╯'));
}

/** Braille spinner on one line; `tick(note)` updates the note, `stop()` clears the line. */
export function spinner(label) {
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  let index = 0;
  let note = '';
  const live = process.stdout.isTTY;
  const draw = () => {
    if (!live) return;
    process.stdout.write(`\r  ${paint.blue(frames[index++ % frames.length])} ${label} ${paint.dim(note)}\x1b[K`);
  };
  const timer = setInterval(draw, 90);
  draw();
  return {
    tick(text) {
      note = text;
    },
    stop() {
      clearInterval(timer);
      if (live) process.stdout.write('\r\x1b[K');
    },
  };
}
