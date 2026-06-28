#!/usr/bin/env python3
"""GENERIC SSR-dump adapter 'corestaff' — mode=dom, body-text -> Row.note.
Ported from legacy extended-source cloak_search.py
(scrape_generic + GENERIC table row 'corestaff'). url_tpl + needs_proxy lifted as-is;
see adapters/_generic.py for the full faithful-relocation note. Raw SSR text dump,
NOT structured — extraction correctness intentionally NOT verified this round."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from adapters._generic import make_generic  # noqa: E402

ADAPTER = make_generic(
    'corestaff',
    'https://www.zaikostore.com/zaikostore/stockList?productName_forFind={q}&pageNumber=1&viewCount=50&headerSearch=1',
    False,
)
