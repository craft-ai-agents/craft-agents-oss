#!/usr/bin/env python3
"""Adapter registry — resolves adapter ids to Adapter objects.

Keep metadata lookup pure: all_ids() must not import adapter implementations,
because some adapters need runtime-only packages or browser dependencies. Only
get_adapters() imports the explicitly requested adapter modules.
"""
from __future__ import annotations

import importlib
from typing import Iterable

from contract import Adapter

# Explicit source-id -> module map. Add new adapters here when registering them.
_MODULES: dict[str, str] = {
    "heilind": "adapters.heilind",
    "digikey": "adapters.digikey",
    "ickey": "adapters.ickey",
    "ickey-replace": "adapters.ickey-replace",
    "avnet": "adapters.avnet",
    "mouser": "adapters.mouser",
    "misumi": "adapters.misumi",
    "misumi-jp": "adapters.misumi-jp",
    "ocpneumatics": "adapters.ocpneumatics",
    "master": "adapters.master",
    "octopart": "adapters.octopart",
    "octopart-alt": "adapters.octopart_alt",
    "szlcsc-overseas": "adapters.szlcsc-overseas",
    "verical": "adapters.verical",
    "rochester": "adapters.rochester",
    "sager": "adapters.sager",
    "tti": "adapters.tti",
    "rs-us": "adapters.rs-us",
    "jbchip": "adapters.jbchip",
    "vanlinkon": "adapters.vanlinkon",
    "future": "adapters.future",
    "newark": "adapters.newark",
    "rs-uk": "adapters.rs_uk",
    "rs-jp": "adapters.rs_jp",
    "rs-hk": "adapters.rs_hk",
    "monotaro": "adapters.monotaro",
    "tme": "adapters.tme",
    "lcsc": "adapters.lcsc",
    "szlcsc": "adapters.szlcsc",
    "xonelec": "adapters.xonelec",
    "peigenesis": "adapters.peigenesis",
    "corestaff": "adapters.corestaff",
    "darisus": "adapters.darisus",
    "componentonline": "adapters.componentonline",
    "element14-cn": "adapters.element14_cn",
    "arrow": "adapters.arrow",
}


def _load_explicit(ids: Iterable[str]) -> dict[str, Adapter]:
    out: dict[str, Adapter] = {}
    for source_id in ids:
        name = _MODULES.get(source_id)
        if not name:
            continue
        mod = importlib.import_module(name)
        a = getattr(mod, "ADAPTER", None)
        if isinstance(a, Adapter):
            out[a.id] = a
    return out


def all_ids() -> list[str]:
    return list(_MODULES.keys())


def get_adapters(ids: Iterable[str]) -> list[Adapter]:
    """Resolve ids to Adapter objects, skipping unknown ids silently (the CLI
    reports availability separately)."""
    requested = list(ids)
    reg = _load_explicit(requested)
    return [reg[i] for i in requested if i in reg]
