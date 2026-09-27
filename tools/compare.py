#!/usr/bin/env python
"""
compare — pixel comparison of a port screenshot against the original's.

    python tools/compare.py ORIGINAL.png PORT.png [--region x,y,w,h] [--out diff.png] [--zoom 3] [--tolerance 8]

Prints, per region: mean absolute difference, the share of pixels off by more than the tolerance, the
largest difference, and the bounding boxes of the differing clusters (so a wrong glyph or border can be
located at once). `--out` writes original | port | amplified difference side by side.

Cost: O(pixels) with numpy; clusters come from a coarse grid (16 px cells), O(cells).
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

CELL = 16  # cluster grid, pixels
DIFF_GAIN = 6  # amplification of the difference panel

RESET = "\x1b[0m"


def paint(rgb: tuple[int, int, int], text: str) -> str:
    return f"\x1b[38;2;{rgb[0]};{rgb[1]};{rgb[2]}m{text}{RESET}"


DIM, BLUE, GREEN, AMBER, RED, MAUVE = (86, 95, 137), (122, 162, 247), (158, 206, 106), (224, 175, 104), (247, 118, 142), (187, 154, 247)


@dataclass(frozen=True)
class Region:
    x: int
    y: int
    w: int
    h: int

    @staticmethod
    def parse(text: str | None, width: int, height: int) -> "Region":
        if not text:
            return Region(0, 0, width, height)
        x, y, w, h = (int(v) for v in text.split(","))
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
            raise SystemExit(f"region {text} does not fit a {width}x{height} image")
        return Region(x, y, w, h)


def load(path: Path) -> np.ndarray:
    if not path.exists():
        raise SystemExit(f"missing image: {path}")
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def clusters(mask: np.ndarray, region: Region) -> list[tuple[int, int, int, int, int]]:
    """Bounding boxes (x, y, w, h, pixels) of differing pixels, merged over a CELL grid (flood fill)."""
    rows, cols = -(-mask.shape[0] // CELL), -(-mask.shape[1] // CELL)
    padded = np.zeros((rows * CELL, cols * CELL), dtype=bool)
    padded[: mask.shape[0], : mask.shape[1]] = mask
    grid = padded.reshape(rows, CELL, cols, CELL).any(axis=(1, 3))
    seen = np.zeros_like(grid)
    boxes = []
    for r0, c0 in zip(*np.nonzero(grid)):
        if seen[r0, c0]:
            continue
        stack, cells = [(r0, c0)], []
        seen[r0, c0] = True
        while stack:
            r, c = stack.pop()
            cells.append((r, c))
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols and grid[nr, nc] and not seen[nr, nc]:
                    seen[nr, nc] = True
                    stack.append((nr, nc))
        rs, cs = [c[0] for c in cells], [c[1] for c in cells]
        y0, y1 = min(rs) * CELL, min((max(rs) + 1) * CELL, mask.shape[0])
        x0, x1 = min(cs) * CELL, min((max(cs) + 1) * CELL, mask.shape[1])
        ys, xs = np.nonzero(mask[y0:y1, x0:x1])
        boxes.append((region.x + x0 + int(xs.min()), region.y + y0 + int(ys.min()), int(xs.max() - xs.min()) + 1, int(ys.max() - ys.min()) + 1, int(mask[y0:y1, x0:x1].sum())))
    return sorted(boxes, key=lambda b: -b[4])


def card(title: str, rows: list[tuple[str, str]]) -> None:
    width = max(len(title) + 4, *(len(k) + len(v) + 5 for k, v in rows)) + 2
    print(paint(DIM, f"  ╭─ ") + paint(MAUVE, title) + paint(DIM, " " + "─" * (width - len(title) - 3) + "╮"))
    for key, value in rows:
        print(paint(DIM, "  │ ") + paint(DIM, key.ljust(12)) + value + " " * max(0, width - len(key.ljust(12)) - len(value) - 1) + paint(DIM, "│"))
    print(paint(DIM, "  ╰" + "─" * (width + 1) + "╯"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Pixel comparison of two screenshots.")
    parser.add_argument("original", type=Path)
    parser.add_argument("port", type=Path)
    parser.add_argument("--region", help="x,y,w,h (default: whole image)")
    parser.add_argument("--out", type=Path, help="side-by-side image to write")
    parser.add_argument("--zoom", type=int, default=1)
    parser.add_argument("--tolerance", type=int, default=8, help="per-channel difference that counts as different")
    parser.add_argument("--top", type=int, default=12, help="clusters to list")
    args = parser.parse_args()

    a, b = load(args.original), load(args.port)
    if a.shape != b.shape:
        raise SystemExit(f"sizes differ: {a.shape[1]}x{a.shape[0]} vs {b.shape[1]}x{b.shape[0]}")
    region = Region.parse(args.region, a.shape[1], a.shape[0])
    ra = a[region.y : region.y + region.h, region.x : region.x + region.w]
    rb = b[region.y : region.y + region.h, region.x : region.x + region.w]
    diff = np.abs(ra - rb)
    worst = diff.max(axis=2)
    mask = worst > args.tolerance
    share = float(mask.mean()) * 100.0
    mean = float(diff.mean())
    verdict = paint(GREEN, "identical") if worst.max() == 0 else paint(GREEN, "match") if share < 0.05 else paint(AMBER, "close") if share < 1.0 else paint(RED, "different")
    card("compare", [
        ("original", str(args.original)),
        ("port", str(args.port)),
        ("region", f"{region.x},{region.y} {region.w}x{region.h}"),
        ("mean diff", f"{mean:.3f} / 255"),
        ("pixels off", f"{share:.3f} %  (> {args.tolerance})"),
        ("max diff", str(int(worst.max()))),
        ("verdict", verdict),
    ])
    for x, y, w, h, count in clusters(mask, region)[: args.top]:
        print(paint(DIM, "    · ") + paint(BLUE, f"{x},{y}".ljust(10)) + f"{w}x{h}".ljust(10) + paint(DIM, f"{count} px"))

    if args.out:
        amplified = np.clip(diff * DIFF_GAIN, 0, 255).astype(np.uint8)
        gap = np.full((region.h, 6, 3), 40, dtype=np.uint8)
        panel = np.concatenate([ra.astype(np.uint8), gap, rb.astype(np.uint8), gap, amplified], axis=1)
        image = Image.fromarray(panel)
        if args.zoom > 1:
            image = image.resize((image.width * args.zoom, image.height * args.zoom), Image.NEAREST)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.out)
        print(paint(DIM, "    → ") + str(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
