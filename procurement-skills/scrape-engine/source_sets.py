#!/usr/bin/env python3
"""Resolve named source sets from source_catalog.yaml.

This intentionally avoids a PyYAML dependency because the deployed
cloakbrowser-python environment is minimal. The parser only reads the simple
top-level source metadata this catalog uses.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable


CATALOG_PATH = Path(__file__).with_name("source_catalog.yaml")
USABLE_STATUSES = {"enabled", "limited"}
EXCLUDED_DIRECT_CHANNEL_TYPES = {
    "aggregator",
    "alternative_candidates",
    "manufacturer_reference",
    "migrated_site",
    "duplicate_site",
    "dead_site",
}
EXCLUDED_DIRECT_TIERS = {"reference", "deprecated"}
ALIASES = {
    "direct": "direct",
    "first-round-direct": "direct",
    "aggregator": "aggregator",
    "aggregators": "aggregator",
}


def _parse_scalar(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value[0] in {"'", '"'} and value[-1:] == value[0]:
        return value[1:-1]
    return value


def _catalog_sources(path: Path = CATALOG_PATH) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    in_sources = False
    current: dict[str, str] | None = None

    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(raw) - len(raw.lstrip(" "))
        if not in_sources:
            in_sources = stripped == "sources:"
            continue

        if indent == 2 and stripped.endswith(":"):
            current = {"id": stripped[:-1]}
            sources.append(current)
            continue

        if indent == 4 and current is not None and ":" in stripped:
            key, value = stripped.split(":", 1)
            current[key.strip()] = _parse_scalar(value)

    return sources


def source_set_names() -> list[str]:
    return sorted(ALIASES)


def source_ids_for_set(source_set: str, catalog_path: Path = CATALOG_PATH) -> list[str]:
    kind = ALIASES.get(source_set)
    if kind is None:
        raise ValueError(
            f"unknown source set: {source_set}; available: {', '.join(source_set_names())}"
        )

    out: list[str] = []
    for source in _catalog_sources(catalog_path):
        status = source.get("status", "")
        channel_type = source.get("channel_type", "")
        tier = source.get("tier", "")
        if status not in USABLE_STATUSES:
            continue

        if kind == "direct":
            if channel_type in EXCLUDED_DIRECT_CHANNEL_TYPES:
                continue
            if tier in EXCLUDED_DIRECT_TIERS:
                continue
            out.append(source["id"])
        elif kind == "aggregator":
            if channel_type == "aggregator":
                out.append(source["id"])

    return out


def source_csv(ids: Iterable[str]) -> str:
    return ",".join(ids)
