#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class SourceSetTests(unittest.TestCase):
    def test_registry_metadata_import_does_not_require_cloakbrowser(self) -> None:
        import registry

        ids = registry.all_ids()

        self.assertIn("digikey", ids)
        self.assertIn("xonelec", ids)

    def test_direct_set_uses_current_direct_platforms_only(self) -> None:
        from source_sets import source_ids_for_set

        ids = source_ids_for_set("direct")

        self.assertIn("digikey", ids)
        self.assertIn("master", ids)
        self.assertIn("rs-jp", ids)
        self.assertIn("element14-cn", ids)
        self.assertIn("ocpneumatics", ids)
        self.assertNotIn("octopart", ids)
        self.assertNotIn("szlcsc-overseas", ids)
        self.assertNotIn("ickey-replace", ids)
        self.assertNotIn("octopart-alt", ids)
        self.assertNotIn("ti", ids)
        self.assertNotIn("chip1stop", ids)

    def test_aggregator_set_is_separate_from_direct_first_round(self) -> None:
        from source_sets import source_ids_for_set

        self.assertEqual(
            source_ids_for_set("aggregator"),
            ["octopart", "szlcsc-overseas"],
        )

    def test_source_sets_reference_registered_adapters(self) -> None:
        import registry
        from source_sets import source_ids_for_set

        known = set(registry.all_ids())

        for source_set in ("direct", "aggregator"):
            missing = sorted(set(source_ids_for_set(source_set)) - known)
            self.assertEqual(missing, [], source_set)


if __name__ == "__main__":
    unittest.main()
