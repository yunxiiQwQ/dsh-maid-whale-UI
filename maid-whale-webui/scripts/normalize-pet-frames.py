"""Register pet action frames around a stable character anchor.

The reference cut-outs share a 238x260 canvas, but their subject placement
varies because detached action effects and captured divider lines distort the
full alpha bounding box. The largest connected alpha component is the pet (and
any attached prop), so it supplies a stable horizontal centre and ground line.
Detached effects follow the same translation and are edge-clamped separately.
The shipped action artwork uses visually calibrated head and ground anchors.
"""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from PIL import Image

DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "assets" / "pet"
CANVAS_W, CANVAS_H = 238, 260
TARGET_X = CANVAS_W // 2
TARGET_BOTTOM = 241
ALPHA_THRESHOLD = 32
DRAGGING_FRAME = "11-dragging.png"
SCALE_CALIBRATION_FRAMES = (
    "01-idle.png",
    "02-happy.png",
    "03-thinking.png",
    "04-confused.png",
    "05-surprised.png",
    "08-success.png",
    "09-error.png",
    "17-angry.png",
    "18-please.png",
    "19-bye.png",
    "20-eating.png",
)


@dataclass(frozen=True)
class Component:
    pixels: tuple[int, ...]
    bbox: tuple[int, int, int, int]

    @property
    def area(self) -> int:
        return len(self.pixels)


def connected_components(image: Image.Image, threshold: int = ALPHA_THRESHOLD) -> list[Component]:
    alpha = image.getchannel("A")
    width, height = image.size
    mask = bytearray(1 if value > threshold else 0 for value in alpha.tobytes())
    seen = bytearray(width * height)
    components: list[Component] = []

    for start, visible in enumerate(mask):
        if not visible or seen[start]:
            continue
        seen[start] = 1
        queue = deque([start])
        pixels: list[int] = []
        min_x = min_y = max(width, height)
        max_x = max_y = -1
        while queue:
            index = queue.popleft()
            y, x = divmod(index, width)
            pixels.append(index)
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
            for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                row = neighbor_y * width
                for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row + neighbor_x
                    if mask[neighbor] and not seen[neighbor]:
                        seen[neighbor] = 1
                        queue.append(neighbor)
        components.append(Component(tuple(pixels), (min_x, min_y, max_x + 1, max_y + 1)))

    return sorted(components, key=lambda component: component.area, reverse=True)


def _is_divider_line(component: Component, width: int) -> bool:
    left, top, right, bottom = component.bbox
    return right - left >= round(width * 0.9) and bottom - top <= 2


def _clamped_shift(component: Component, dx: int, dy: int, size: tuple[int, int]) -> tuple[int, int]:
    width, height = size
    left, top, right, bottom = component.bbox
    return (
        min(max(dx, -left), width - right),
        min(max(dy, -top), height - bottom),
    )


def normalize(image: Image.Image, target: int = 234) -> Image.Image:
    """Translate the subject to the shared anchor without resampling its pixels.

    ``target`` remains accepted for compatibility with the previous scale-based
    command; registration deliberately preserves the source scale.
    """

    del target
    image = image.convert("RGBA")
    if image.size != (CANVAS_W, CANVAS_H):
        raise ValueError(f"expected {CANVAS_W}x{CANVAS_H} frame, got {image.size[0]}x{image.size[1]}")
    anchor_components = [
        component for component in connected_components(image) if not _is_divider_line(component, image.width)
    ]
    if not anchor_components:
        raise ValueError("frame has no content")

    subject = anchor_components[0]
    left, _, right, bottom = subject.bbox
    dx = round(TARGET_X - (left + right) / 2)
    dy = TARGET_BOTTOM - bottom
    source = image.load()
    output = Image.new("RGBA", image.size, (0, 0, 0, 0))
    artwork = [
        component
        for component in connected_components(image, threshold=0)
        if not _is_divider_line(component, image.width)
    ]

    for component in artwork:
        component_dx, component_dy = _clamped_shift(component, dx, dy, image.size)
        layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        layer_pixels = layer.load()
        for index in component.pixels:
            y, x = divmod(index, image.width)
            layer_pixels[x + component_dx, y + component_dy] = source[x, y]
        output.alpha_composite(layer)

    return output


def _subject(image: Image.Image) -> Component:
    components = [
        component for component in connected_components(image) if not _is_divider_line(component, image.width)
    ]
    if not components:
        raise ValueError("frame has no content")
    return components[0]


def scale_around_subject_anchor(image: Image.Image, scale: float) -> Image.Image:
    """Scale the complete action artwork while keeping the pet anchor stable."""

    image = image.convert("RGBA")
    if image.size != (CANVAS_W, CANVAS_H):
        raise ValueError(f"expected {CANVAS_W}x{CANVAS_H} frame, got {image.size[0]}x{image.size[1]}")
    if not 0.5 <= scale <= 1.5:
        raise ValueError(f"unsafe pet scale factor: {scale:.4f}")

    subject = _subject(image)
    left, _, right, bottom = subject.bbox
    subject_x = (left + right) / 2
    clean = Image.new("RGBA", image.size, (0, 0, 0, 0))
    source = image.load()
    clean_pixels = clean.load()
    for component in connected_components(image, threshold=0):
        if _is_divider_line(component, image.width):
            continue
        for index in component.pixels:
            y, x = divmod(index, image.width)
            clean_pixels[x, y] = source[x, y]

    scaled_size = (round(image.width * scale), round(image.height * scale))
    scaled = clean.resize(scaled_size, Image.Resampling.LANCZOS)
    offset = (
        round(TARGET_X - subject_x * scale),
        round(TARGET_BOTTOM - bottom * scale),
    )
    output = Image.new("RGBA", image.size, (0, 0, 0, 0))
    output.alpha_composite(scaled, dest=offset)
    return normalize(output)


def _replace_file(path: Path, normalized: Image.Image) -> None:
    temporary = path.with_name(f".{path.stem}.tmp.png")
    try:
        normalized.save(temporary)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def normalize_file(path: Path, target: int = 234, scale: float = 1.0) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGBA")
        image.load()
    normalized = normalize(image, target) if scale == 1.0 else scale_around_subject_anchor(image, scale)
    _replace_file(path, normalized)
    return normalized


def normalize_directory(root: Path, match_scale_to: str | None = None, target: int = 234) -> float:
    paths = sorted(root.glob("*.png"))
    scale = 1.0
    if match_scale_to is not None:
        images: dict[str, Image.Image] = {}
        for path in paths:
            with Image.open(path) as source:
                images[path.name] = source.convert("RGBA")
                images[path.name].load()
        if match_scale_to not in images:
            raise ValueError(f"scale reference frame not found: {match_scale_to}")
        _, reference_top, _, reference_bottom = _subject(images[match_scale_to]).bbox
        calibration_heights = []
        for name in SCALE_CALIBRATION_FRAMES:
            if name not in images or name == match_scale_to:
                continue
            _, top, _, bottom = _subject(images[name]).bbox
            calibration_heights.append(bottom - top)
        if not calibration_heights:
            raise ValueError("no standing frames available for scale calibration")
        scale = (reference_bottom - reference_top) / median(calibration_heights)

    for path in paths:
        frame_scale = 1.0 if path.name == match_scale_to else scale
        normalized = normalize_file(path, target, frame_scale)
        subject = _subject(normalized)
        left, top, right, bottom = subject.bbox
        print(
            f"{path.name}: subject centre {(left + right) / 2:.1f}, "
            f"baseline {bottom}, box {right - left}x{bottom - top}"
        )
    return scale


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--target", type=int, default=234, help=argparse.SUPPRESS)
    parser.add_argument(
        "--match-scale-to",
        default=None,
        help=f"uniformly match other actions to this frame (for example {DRAGGING_FRAME})",
    )
    args = parser.parse_args()
    scale = normalize_directory(args.root, args.match_scale_to, args.target)
    if args.match_scale_to is not None:
        print(f"matched other actions to {args.match_scale_to} with scale {scale:.4f}")


if __name__ == "__main__":
    main()
