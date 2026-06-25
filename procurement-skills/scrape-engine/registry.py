#!/usr/bin/env python3
"""Adapter registry — collects Adapter objects by id.

Extension point for the ~20 adapters still to port: drop a new module in
adapters/ that defines a top-level `ADAPTER` (an Adapter instance), then add its
import to `_MODULES` below. The directory-scan fallback (`_discover`) picks up
any adapters/*.py exposing ADAPTER automatically, so for the fan-out you can
either list modules explicitly (fast, import-error-loud) or rely on the scan.

Kept deliberately dumb: a dict id->Adapter. No magic.
"""
from __future__ import annotations

import importlib
import os
import pkgutil
from typing import Iterable

from contract import Adapter

# Explicit list — the 3 reference adapters. Add new module names here as they
# land (e.g. "mouser", "master", "verical", ...). Explicit > scan when you want
# an import error to fail loud at startup.
_MODULES = [
    "adapters.heilind",
    "adapters.digikey",
    "adapters.ickey",
    "adapters.ickey-replace",
    "adapters.avnet",
    "adapters.mouser",
    "adapters.misumi",
    "adapters.misumi-jp",
    "adapters.ocpneumatics",
    "adapters.master",
    "adapters.octopart",
    "adapters.octopart_alt",
    "adapters.verical",
    "adapters.rochester",
    "adapters.sager",
    "adapters.tti",
    "adapters.rs-us",
    "adapters.jbchip",
    "adapters.vanlinkon",
    # GENERIC SSR-dump dom adapters (mode=dom, body-text -> note). One file per
    # site, all built by adapters/_generic.make_generic. Ported byte-faithfully
    # from cloak_search.scrape_generic + its GENERIC table.
    "adapters.future",
    "adapters.newark",
    "adapters.rs_uk",
    "adapters.rs_jp",
    "adapters.rs_hk",
    "adapters.monotaro",
    "adapters.tme",
    "adapters.lcsc",
    "adapters.szlcsc",
    "adapters.xonelec",
    "adapters.peigenesis",
    "adapters.corestaff",
    "adapters.darisus",
    "adapters.componentonline",
    "adapters.element14_cn",
    "adapters.arrow",
]


def _load_explicit() -> dict[str, Adapter]:
    out: dict[str, Adapter] = {}
    for name in _MODULES:
        mod = importlib.import_module(name)
        a = getattr(mod, "ADAPTER", None)
        if isinstance(a, Adapter):
            out[a.id] = a
    return out


def _discover() -> dict[str, Adapter]:
    """Directory-scan fallback: import every adapters/*.py and collect ADAPTER.
    Lets the next fan-out add a file without touching this list. Import failures
    here are swallowed per-module so one broken adapter can't sink the registry."""
    out: dict[str, Adapter] = {}
    pkg_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "adapters")
    for info in pkgutil.iter_modules([pkg_dir]):
        if info.name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"adapters.{info.name}")
        except Exception:
            continue
        a = getattr(mod, "ADAPTER", None)
        if isinstance(a, Adapter):
            out.setdefault(a.id, a)
    return out


def _registry() -> dict[str, Adapter]:
    reg = _load_explicit()
    # merge in anything the scan finds that the explicit list missed
    for aid, a in _discover().items():
        reg.setdefault(aid, a)
    return reg


def all_ids() -> list[str]:
    return list(_registry().keys())


def get_adapters(ids: Iterable[str]) -> list[Adapter]:
    """Resolve ids to Adapter objects, skipping unknown ids silently (the CLI
    reports availability separately)."""
    reg = _registry()
    return [reg[i] for i in ids if i in reg]
