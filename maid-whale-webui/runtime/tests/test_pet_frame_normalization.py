from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts" / "normalize-pet-frames.py"
SPEC = importlib.util.spec_from_file_location("normalize_pet_frames", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
NORMALIZER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = NORMALIZER
SPEC.loader.exec_module(NORMALIZER)


class PetFrameNormalizationTests(unittest.TestCase):
    def test_normalize_directory_matches_other_frames_to_dragging_scale(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def save_frame(name: str, box: tuple[int, int, int, int]) -> None:
                image = Image.new("RGBA", (238, 260), (0, 0, 0, 0))
                ImageDraw.Draw(image).rectangle(box, fill=(30, 80, 220, 255))
                image.save(root / name)

            save_frame("11-dragging.png", (69, 50, 168, 199))
            save_frame("01-idle.png", (19, 20, 218, 219))
            save_frame("16-sleeping.png", (69, 100, 168, 199))

            NORMALIZER.normalize_directory(root, match_scale_to="11-dragging.png")

            heights = {}
            for path in root.glob("*.png"):
                image = Image.open(path).convert("RGBA")
                _, top, _, bottom = NORMALIZER.connected_components(image)[0].bbox
                heights[path.name] = bottom - top

            self.assertAlmostEqual(heights["01-idle.png"], heights["11-dragging.png"], delta=2)
            self.assertAlmostEqual(heights["16-sleeping.png"], 75, delta=2)

    def test_normalize_file_replaces_rgba_png_without_leaving_a_process_file(self) -> None:
        self.assertTrue(hasattr(NORMALIZER, "normalize_file"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "11-dragging.png"
            image = Image.new("RGBA", (238, 260), (0, 0, 0, 0))
            ImageDraw.Draw(image).rectangle((30, 20, 129, 199), fill=(220, 30, 30, 255))
            image.save(path)

            NORMALIZER.normalize_file(path)

            with Image.open(path) as normalized:
                self.assertEqual(normalized.size, (238, 260))
            self.assertEqual(list(Path(directory).glob("*.tmp.png")), [])

    def test_normalize_anchors_the_subject_instead_of_the_full_effect_bounds(self) -> None:
        image = Image.new("RGBA", (238, 260), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 20, 129, 199), fill=(220, 30, 30, 255))
        draw.rectangle((180, 30, 189, 39), fill=(30, 60, 220, 255))
        draw.rectangle((0, 250, 237, 251), fill=(80, 80, 80, 96))

        normalized = NORMALIZER.normalize(image, target=234)
        pixels = normalized.load()
        subject_points = [
            (x, y)
            for y in range(normalized.height)
            for x in range(normalized.width)
            if pixels[x, y][0] > 180 and pixels[x, y][1] < 80
        ]
        effect_points = [
            (x, y)
            for y in range(normalized.height)
            for x in range(normalized.width)
            if pixels[x, y][2] > 180 and pixels[x, y][0] < 80
        ]

        self.assertTrue(subject_points)
        self.assertTrue(effect_points)
        left = min(x for x, _ in subject_points)
        right = max(x for x, _ in subject_points) + 1
        bottom = max(y for _, y in subject_points) + 1
        self.assertEqual((left + right) / 2, 119)
        self.assertEqual(bottom, 241)
        self.assertFalse(any(pixels[x, y][3] for y in (250, 251) for x in range(normalized.width)))

    def test_shipped_frames_use_one_canvas_without_clipping(self) -> None:
        for path in sorted((ROOT / "assets/pet").glob("*.png")):
            with self.subTest(frame=path.name), Image.open(path) as image:
                self.assertEqual(image.size, (238, 260))
                self.assertEqual(image.mode, "RGBA")
                bounds = image.getchannel("A").point(lambda a: 255 if a > 32 else 0).getbbox()
                self.assertGreaterEqual(bounds[0], 2)
                self.assertGreaterEqual(bounds[1], 2)
                self.assertLessEqual(bounds[2], image.width - 2)
                self.assertLessEqual(bounds[3], image.height - 2)


if __name__ == "__main__":
    unittest.main()
