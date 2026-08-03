from __future__ import annotations

import unittest

from ._tool_test_harness import sanitize_python_environment


class ToolTestHarnessTests(unittest.TestCase):
    def test_python_controls_are_removed_case_insensitively(self) -> None:
        env = sanitize_python_environment({
            "SAFE_VAR": "kept",
            "PyThOnPaTh": "poisoned-path",
            "pythonhome": "poisoned-home",
            "Virtual_Env": "poisoned-venv",
        })

        self.assertEqual(env["SAFE_VAR"], "kept")
        normalized_keys = {key.upper() for key in env}
        self.assertNotIn("PYTHONPATH", normalized_keys)
        self.assertNotIn("PYTHONHOME", normalized_keys)
        self.assertNotIn("VIRTUAL_ENV", normalized_keys)


if __name__ == "__main__":
    unittest.main()