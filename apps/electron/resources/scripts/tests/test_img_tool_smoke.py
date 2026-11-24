from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path

from ._tool_test_harness import build_env, run_tool


class ImgToolSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.env = build_env()
        cls.tmpdir_obj = tempfile.TemporaryDirectory(prefix="img-tool-smoke-")
        cls.tmpdir = Path(cls.tmpdir_obj.name)

        png_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n2WQAAAAASUVORK5CYII="
        )
        cls.input_png = cls.tmpdir / "input.png"
        cls.input_png.write_bytes(png_bytes)

        # A 320x240 HEIC (ftyp brand "heix") produced by `sips -s format heic`.
        # Exercises the pillow-heif read path bundled with the tool.
        heic_bytes = base64.b64decode(
            "AAAAJGZ0eXBoZWl4AAAAAG1pZjFNaVByTWlIQW1pYWZoZWl4AAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAABQAAAAPAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCgoKAAAAcWh2Y0MBAiAAAACwAAAAAAA88AD8/fr6AAALA6AAAQAYQAEMAf//AiAAAAMAsAAAAwAAAwA8FwJAoQABACJCAQECIAAAAwCwAAADAAADADygCggPE2IF7kWVTcCAgYAgogABAAlEAcBgnLIRFNkAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAAGRAAAAAW1kYXQAAAAAAAABoQAAAY0oAa+IPHdL06NM8nhNkn0g3ndTBr39mz8JdQjMh9tzUr99AlshR2yj+b/Nnlzx/vk63ypyhdfi27wRugQwkOlYcUOBAQZQWzIQlO1BMiuxWd2kmFoF4tk9LZK3t+T/HUtQ3nna/UPny16EP6+KYhG+K1x0fPC/KiI6N3UTNfwmXf+TywVgZ63YqASry4KAcM53k7ZjLtUGorJCPWRdrCHeLHb0Dm7zn5dpmEvWJ//qjJXCvJj62kRL1bHoev2AOKLxJN9IgOiCY3NNnweAL2Gga78wXVN4X894baneJpKVpHJFoiEOgEpgZ8L1EEL58Y9tXxH+3/YF5K2bfaBpX2YqQZ9RFiI8OvqqgE2DPI2teIyrSI4Egx448AZIMBGNypUhPdbNAR/ldRz56gPU96l94E1tmw/8n+NIlBu+lQw0nXYoXRa1Ty5atw06oArsmkn3XW4xhUcOkXFc8PYNZAFmx0nY6lvLeDFSkXxCbkBS8jvm/VKugWv7/CoVqy8YtPGASCzfWY2AAAADAAOm"
        )
        cls.input_heic = cls.tmpdir / "input.heic"
        cls.input_heic.write_bytes(heic_bytes)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmpdir_obj.cleanup()

    def run_tool(self, *args: str):
        return run_tool("img-tool", *args, env=self.env)

    def test_info_resize_convert(self) -> None:
        info = self.run_tool("info", str(self.input_png))
        self.assertEqual(info.returncode, 0, msg=info.stderr)
        meta = json.loads(info.stdout)
        self.assertEqual(meta["format"], "PNG")

        resized = self.tmpdir / "resized.png"
        resize = self.run_tool("resize", str(self.input_png), "--scale", "2", "-o", str(resized))
        self.assertEqual(resize.returncode, 0, msg=resize.stderr)
        self.assertTrue(resized.exists())

        converted = self.tmpdir / "converted.jpg"
        conv = self.run_tool("convert", str(resized), "--format", "jpg", "-o", str(converted))
        self.assertEqual(conv.returncode, 0, msg=conv.stderr)
        self.assertTrue(converted.exists())

    def test_heic_info_and_convert(self) -> None:
        # Reading HEIC requires the bundled pillow-heif opener.
        info = self.run_tool("info", str(self.input_heic))
        self.assertEqual(info.returncode, 0, msg=info.stderr)
        meta = json.loads(info.stdout)
        self.assertEqual(meta["format"], "HEIF")
        self.assertEqual(meta["width"], 320)
        self.assertEqual(meta["height"], 240)

        converted = self.tmpdir / "from_heic.jpg"
        conv = self.run_tool("convert", str(self.input_heic), "--format", "jpg", "-o", str(converted))
        self.assertEqual(conv.returncode, 0, msg=conv.stderr)
        self.assertTrue(converted.exists())

    def test_invalid_resize_fails(self) -> None:
        bad = self.tmpdir / "bad.png"
        result = self.run_tool("resize", str(self.input_png), "--scale", "0", "-o", str(bad))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be positive", result.stderr)


if __name__ == "__main__":
    unittest.main()
