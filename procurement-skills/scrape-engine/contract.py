#!/usr/bin/env python3
"""L3 — the contract every adapter and every layer hangs off. Types ONLY.

This module imports NOTHING from resource.py / antibot.py / engine.py. It is the
bottom of the stack: L1 (resource.py, hardware/deploy) and L2 (antibot.py,
adversary) both import these types; adapters import these types. That one-way
dependency is the whole point of the split.

Three things live here and nothing else:

  Row      — the structured result.
             HONEST scope: api/xhr adapters (digikey, ickey, …) yield genuinely
             structured Rows — brand/stock/price_breaks are typed fields, NOT a
             pipe-joined blob. dom/script adapters that merely dump the rendered
             body do NOT produce structure: they put RAW TEXT in `note` and the
             agent re-parses it downstream. Do NOT pretend a body-dump Row is
             structured. (A script adapter that talks a real JSON API in-page —
             heilind/sager-class — CAN fill typed fields; a script adapter that
             scrapes body text — octopart-alt-class — cannot. Mode does not
             decide structure; what the adapter actually parses does.)

  Defense  — a NAMED anti-bot profile reference + optional per-adapter overrides.
             Replaces the old flat AntiBot. An adapter points at a profile by
             name ('perimeterx' / 'akamai' / 'datadome' / 'none' / 'direct') and
             may override individual knobs. L2 (antibot.py) owns the profile
             REGISTRY and the navigate flow; this is just the DATA an adapter
             hands it. None = the 'none' profile (go once, no dance).

  Adapter  — pure description of how to scrape ONE site in ONE mode. Owns NO
             browser, NO proxy, NO retry loop, NO warmup — those are mechanics
             owned by L1/L2. An adapter only knows: which url to hit, (xhr) which
             response substring carries the JSON, how to turn a payload into
             Rows, which defense profile to use, and (script) how to drive the
             live page itself.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Awaitable, Callable, Literal, Optional


# A single quantity break. rmb/usd kept separate (ickey gives both); either may
# be None. We do NOT collapse to one "price" string — agents want the curve.
PriceBreak = dict  # {"qty": int, "rmb": float|None, "usd": float|None}


@dataclass
class Row:
    """One product/offer row. Use Row(...) then to_dict() for JSON.

    Every field is optional except `part` (the query) and `platform` (the source
    id). Missing != zero: stock=None means "unknown", stock=0 means "known out of
    stock". For body-dump dom/script adapters, `note` carries RAW page text and
    the structured fields stay None — that is expected and honest, not a bug."""
    part: str                                    # the query string that produced this row
    platform: str                               # adapter id, e.g. "digikey"
    mpn: Optional[str] = None                    # manufacturer part number
    brand: Optional[str] = None                  # manufacturer / brand name
    package: Optional[str] = None                # package / case, e.g. "0805"
    stock: Optional[int] = None                  # qty available; None = unknown
    in_stock: Optional[bool] = None              # tri-state; None = unknown
    price_breaks: list = field(default_factory=list)  # list[PriceBreak]
    lead_time: Optional[str] = None              # raw lead-time string from site
    datasheet: Optional[str] = None              # datasheet URL
    product_url: Optional[str] = None            # canonical product page URL
    description: Optional[str] = None            # short description / spec blurb
    category: Optional[str] = None               # category / part class
    blocked: bool = False                        # True if anti-bot blocked the fetch
    availability_status: Optional[str] = None     # e.g. "maintenance", "no_result"
    note: Optional[str] = None                   # free-form: relevance flags, RAW dumped text, etc.

    def to_dict(self) -> dict:
        return asdict(self)


def make_break(qty: int, rmb: Optional[float] = None, usd: Optional[float] = None) -> dict:
    """Helper so adapters don't hand-build the dict shape inconsistently."""
    return {"qty": qty, "rmb": rmb, "usd": usd}


# ---------------------------------------------------------------------------
# Defense — a named profile reference + per-adapter overrides.
# ---------------------------------------------------------------------------

# Names of the anti-bot profiles defined in L2 (antibot.py PROFILES). A Defense
# either points at one of these (and optionally tweaks knobs) OR is None, which
# antibot.py treats as the 'none' profile (single goto, BLOCK_PAT-only check).
ProfileName = Literal["none", "direct", "perimeterx", "akamai", "datadome"]


@dataclass
class Defense:
    """Per-adapter anti-bot DATA. `profile` names an L2 profile; every other
    field, when not None, OVERRIDES that profile's default for this one adapter.

    The profile owns the real policy (warmup_url, retries, block_pat,
    block_resources, min_body_len, fresh_browser_per_attempt, dwell timings).
    Most adapters just say Defense('perimeterx') and inherit everything. Override
    only the knob that genuinely differs for this site (e.g. a per-adapter
    warmup_url, or a tighter min_body_len). None on an override == "use the
    profile's value"; it does NOT mean zero.

    The four MUST-PRESERVE review fixes all live in the PROFILE defaults (see
    antibot.py PROFILES): env-proxy strip is in L1 around launch; block_resources
    defaults False; fresh_browser_per_attempt is a real Chromium relaunch;
    min_body_len defaults 0 (opt-in). Overriding here can only make a single
    adapter stricter/looser — it cannot un-fix the defaults for everyone."""
    profile: ProfileName = "none"
    # --- overrides (None = inherit the profile default) ---
    warmup_url: Optional[str] = None             # homepage hit first to seed PX/Akamai cookie
    retries: Optional[int] = None                # total attempts (1 = no retry)
    warmup_wait_ms: Optional[int] = None         # dwell after warmup goto
    settle_wait_ms: Optional[int] = None         # dwell after the real goto before extract
    min_body_len: Optional[int] = None           # opt-in short-body block heuristic (0 = off)
    block_resources: Optional[bool] = None       # abort image/media (default False per profile)
    fresh_browser_per_attempt: Optional[bool] = None  # relaunch whole Chromium per retry


# ---------------------------------------------------------------------------
# Adapter — pure per-site/per-mode description.
# ---------------------------------------------------------------------------

Mode = Literal["api", "dom", "xhr", "script"]
Tier = Literal["core", "more"]


@dataclass
class Adapter:
    """Pure description of one site in one mode. No browser welded in.

    mode semantics — what `extract(payload, part)` receives as `payload`, and
    what it must return:

      "api"    -> payload = parsed JSON from api_fetch (adapter does its own
                  HTTP, no browser). extract is plain sync. Yields STRUCTURED Rows.

      "xhr"    -> payload = parsed JSON (dict/list) of the FIRST response whose
                  URL contains `match_xhr`. L2 sniffs responses and feeds it in.
                  extract is plain sync. Yields STRUCTURED Rows.

      "dom"    -> payload = the live Playwright async Page, already
                  warmed/retried/settled past the defense wall by L2. extract is
                  `async def` (it awaits the Page). Typically a BODY DUMP -> raw
                  text in Row.note (NOT structured).

      "script" -> ESCAPE HATCH. payload = a ScriptCtx (live WARMED Page +
                  helpers). The defense profile has run its warmup (PX/Akamai
                  cookies seeded in this context) but has NOT navigated to the
                  search URL — the ADAPTER owns EVERY goto. That is deliberate:
                  it lets ports whose data XHR fires on the FIRST navigation
                  (sager: ccstore inventories/prices/skus; jbchip:
                  /api/item/goods/v1) wire ctx.on_response(needle) BEFORE their
                  first goto, instead of doing a wasted redundant second goto.
                  From here the adapter drives everything — multi-hop page.goto,
                  query_selector_all, page.fill, page.click, page.evaluate (incl.
                  in-page authed fetch) — and runs its own per-hop block check via
                  ctx.blocked(). extract is `async def`. Used by the 6 sites the 3
                  simple modes can't express (octopart-alt, sager, rochester,
                  heilind, ocpneumatics, jbchip). Structure depends on what the
                  adapter parses: a real in-page JSON API CAN fill typed fields; a
                  body-text scrape cannot (raw text -> note).

    L2 awaits dom/script extract coroutines; api/xhr extract are sync.
    """
    id: str
    tier: Tier
    mode: Mode
    url: Callable[[str], str]                        # part -> search URL
    extract: Callable[..., Any]                      # (payload, part) -> list[Row] | Awaitable[list[Row]]
    needs_proxy: bool = False                        # which L1 browser bucket (proxy vs machine-direct)
    match_xhr: Optional[str] = None                  # REQUIRED for mode="xhr"
    defense: Optional[Defense] = None                # named anti-bot profile + overrides; None = 'none'
    # api mode only: async callable (part, limit) -> parsed JSON. No browser.
    api_fetch: Optional[Callable[..., Awaitable[Any]]] = None
    # which host to serialize on (站内串行). Defaults to url()'s host; set when
    # warmup/script hops a DIFFERENT host than the search URL.
    host_key: Optional[str] = None


__all__ = [
    "PriceBreak", "Row", "make_break",
    "Defense", "ProfileName",
    "Adapter", "Mode", "Tier",
]
