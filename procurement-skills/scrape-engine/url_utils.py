#!/usr/bin/env python3
from __future__ import annotations

import urllib.parse


def q(part: str) -> str:
    """Percent-encode a part number for URL embedding."""
    return urllib.parse.quote(part, safe="")
