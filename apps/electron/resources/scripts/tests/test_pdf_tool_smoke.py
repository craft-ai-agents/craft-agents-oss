"""Smoke tests for pdf_tool hardening behaviors.

Run manually:
    cd /Users/balintorosz/Documents/GitHub/craft-agents
    python3 -m unittest apps.electron.resources.scripts.tests.test_pdf_tool_smoke
"""

from __future__ import annotations

import base64
import os
import platform
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[5]
BIN_DIR = REPO_ROOT / "apps" / "electron" / "resources" / "bin"
SCRIPTS_DIR = REPO_ROOT / "apps" / "electron" / "resources" / "scripts"


def resolve_platform_key() -> str:
    sys_name = platform.system().lower()
    machine = platform.machine().lower()

    if machine in ("x86_64", "amd64"):
        arch = "x64"
    elif machine in ("arm64", "aarch64"):
        arch = "arm64"
    else:
        arch = machine

    if sys_name.startswith("darwin"):
        os_key = "darwin"
    elif sys_name.startswith("linux"):
        os_key = "linux"
    elif sys_name.startswith("windows"):
        os_key = "win32"
    else:
        os_key = os.name

    return f"{os_key}-{arch}"


class PdfToolSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        platform_key = resolve_platform_key()
        uv_name = "uv.exe" if os.name == "nt" else "uv"
        cls.uv = BIN_DIR / platform_key / uv_name
        if not cls.uv.exists():
            uv_fallback = shutil.which("uv")
            if uv_fallback:
                cls.uv = Path(uv_fallback)
            else:
                raise unittest.SkipTest(
                    f"No bundled uv at {BIN_DIR / platform_key / uv_name} and no uv on PATH"
                )

        cls.wrapper = BIN_DIR / ("pdf-tool.cmd" if os.name == "nt" else "pdf-tool")
        if not cls.wrapper.exists():
            raise unittest.SkipTest(f"pdf-tool wrapper not found: {cls.wrapper}")

        cls.env = dict(os.environ)
        cls.env["CRAFT_UV"] = str(cls.uv)
        cls.env["CRAFT_SCRIPTS"] = str(SCRIPTS_DIR)
        cls.env["PATH"] = os.pathsep.join([
            str(BIN_DIR),
            str(cls.uv.parent),
            cls.env.get("PATH", ""),
        ])

        cls.tmpdir_obj = tempfile.TemporaryDirectory(prefix="pdf-tool-smoke-")
        cls.tmpdir = Path(cls.tmpdir_obj.name)

        # Small 1x1 transparent PNG.
        png_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n2WQAAAAASUVORK5CYII="
        )
        image_paths: list[Path] = []
        for i in range(3):
            img_path = cls.tmpdir / f"img_{i + 1}.png"
            img_path.write_bytes(png_bytes)
            image_paths.append(img_path)

        cls.input_pdf = cls.tmpdir / "input.pdf"
        result = subprocess.run(
            [str(cls.wrapper), "from-image", *(str(p) for p in image_paths), "-o", str(cls.input_pdf)],
            cwd=REPO_ROOT,
            env=cls.env,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Failed to create fixture PDF: {result.stderr}")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmpdir_obj.cleanup()

    def run_tool(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.wrapper), *args],
            cwd=REPO_ROOT,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_invalid_pages_out_of_range_fails(self) -> None:
        result = self.run_tool("extract", str(self.input_pdf), "--pages", "999")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("out of bounds", result.stderr)

    def test_reorder_conflicting_flags_fails(self) -> None:
        output = self.tmpdir / "reordered.pdf"
        result = self.run_tool(
            "reorder",
            str(self.input_pdf),
            "--order",
            "1,2",
            "--reverse",
            "-o",
            str(output),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("mutually exclusive", result.stderr)

    def test_duplicate_copies_lower_bound_fails(self) -> None:
        output = self.tmpdir / "dup.pdf"
        result = self.run_tool(
            "duplicate",
            str(self.input_pdf),
            "--pages",
            "1",
            "--copies",
            "1",
            "-o",
            str(output),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("x>=2", result.stderr)

    def test_to_pptx_invalid_selection_fails_gracefully(self) -> None:
        output = self.tmpdir / "out.pptx"
        result = self.run_tool(
            "to-pptx",
            str(self.input_pdf),
            "--pages",
            "999",
            "-o",
            str(output),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("out of bounds", result.stderr)
        self.assertNotIn("IndexError", result.stderr)

    def test_sanitize_happy_path(self) -> None:
        output = self.tmpdir / "sanitized.pdf"
        result = self.run_tool("sanitize", str(self.input_pdf), "-o", str(output))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertTrue(output.exists())


if __name__ == "__main__":
    unittest.main()
