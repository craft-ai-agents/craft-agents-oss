#!/usr/bin/env python3
"""L2 — adversary concern. The navigate() flow + block detection, organized as
per-DEFENSE PROFILES. Knows nothing about RAM, proxy buckets, or scheduling
(that is L1/resource.py); knows nothing about a site's grid (that is the adapter).

A PROFILE bundles everything that defines how to beat ONE class of bot wall:
  warmup_url, retries, warmup_wait_ms, settle_wait_ms,
  block_pat, block_resources, min_body_len, fresh_browser_per_attempt.

Profiles defined here:
  none        — no dance. single goto, generic BLOCK_PAT check, no retry. (default)
  direct      — same as none but documents "must be machine-direct" (no proxy).
  perimeterx  — homepage warmup -> seed PX cookie -> goto -> block-check -> retry
                with a FRESH BROWSER PROCESS per attempt (the real PX reset).
                Shared by: avnet, octopart-alt, tti.
  akamai      — homepage warmup -> goto -> block-check -> retry (fresh context).
                Shared by: master.
  datadome    — homepage warmup -> goto -> block-check -> retry (fresh context).
                Used by: rs-us.

An adapter's contract.Defense names a profile and may OVERRIDE individual knobs
(e.g. its own warmup_url). _resolve() merges profile + overrides into one
effective policy.

The four MUST-PRESERVE review fixes are encoded in the profile DEFAULTS:
  #1 env-proxy strip   — done in L1 (resource._launch) around every launch.
  #2 block_resources   — DEFAULT False on every profile; only XHR/SSR opt in.
  #3 fresh_browser     — perimeterx sets fresh_browser_per_attempt=True =
                         relaunch a whole Chromium per retry (resource.fresh()).
  #4 min_body_len      — DEFAULT 0 (opt-in); generic dom blocks purely on
                         block_pat. avnet opts in to 80 via a Defense override.

SCRIPT escape-hatch: for mode="script", L2 runs ONLY the profile's warmup (seed
PX/Akamai/DataDome cookies) and then hands the adapter a ScriptCtx (live warmed
Page + helpers + the profile's block_pat) WITHOUT navigating to the search URL.
The adapter owns EVERY goto from there — so it can attach its own
page.on('response') (ctx.on_response) BEFORE the first navigation, which is the
capture point for ports whose data XHR fires on the first nav (sager, jbchip).
The adapter runs the per-hop block check itself via ctx.blocked(); L2 does not
pre-navigate, so there is no forced double-goto / doubled bot-wall exposure.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, replace
from typing import Any, Optional, Pattern

from contract import Adapter, Defense


# Generic anti-bot block signature, lifted verbatim from the old scripts. This is
# the profile default block_pat; perimeterx narrows it (OCTOPART_BLOCK-class) via
# its own pattern below.
BLOCK_PAT: Pattern = re.compile(
    r"(access denied|just a moment|verify you are human|captcha|"
    r"pardon our interruption|are you a robot|challenge validation|"
    r"press\s*&?\s*hold|confirm you are a human|before we continue|"
    r"security check|px block|block type|one more step|trouble continuing|"
    r"滑动验证|请完成|forbidden|cf-error|403 error)",
    re.I,
)

# Narrower PerimeterX signal (old OCTOPART_BLOCK). Avoids false-positives on
# legit SPA copy that merely contains the word "captcha" in a footer, etc.
PX_BLOCK_PAT: Pattern = re.compile(
    r"(access denied|press\s*&?\s*hold|are you a (?:human|robot)|"
    r"verify you are human|px-captcha|perimeterx|please enable javascript|"
    r"before we continue)",
    re.I,
)


# ---------------------------------------------------------------------------
# Profile — the per-defense policy. All knobs in ONE place.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Profile:
    """Effective anti-bot policy for one defense class. Frozen — adapters tweak
    via Defense overrides, not by mutating the shared profile object."""
    name: str
    warmup_url: Optional[str] = None
    retries: int = 1
    warmup_wait_ms: int = 4000
    settle_wait_ms: int = 6000
    block_pat: Pattern = BLOCK_PAT
    block_resources: bool = False        # FIX #2: default OFF everywhere
    min_body_len: int = 0                # FIX #4: opt-in; 0 = no length check
    fresh_browser_per_attempt: bool = False  # FIX #3: relaunch whole Chromium


# The profile REGISTRY. Adapters reference these by name via Defense.profile.
PROFILES: dict[str, Profile] = {
    "none": Profile(name="none"),
    # direct == none policy-wise, but the adapter should set needs_proxy=False so
    # L1 hands it the machine-direct bucket (FIX #1 keeps it truly direct).
    "direct": Profile(name="direct"),
    # PerimeterX: warmup homepage, then per-attempt fresh Chromium process.
    "perimeterx": Profile(
        name="perimeterx",
        retries=4,                       # PX intermittent, ~1/3 pass
        warmup_wait_ms=5000,
        settle_wait_ms=6000,
        block_pat=PX_BLOCK_PAT,
        fresh_browser_per_attempt=True,  # FIX #3: real PX reset
    ),
    # Akamai: warmup + retry, fresh CONTEXT (not a whole process).
    "akamai": Profile(
        name="akamai",
        retries=3,
        warmup_wait_ms=4000,
        settle_wait_ms=5000,
        block_pat=BLOCK_PAT,
    ),
    # DataDome: warmup + retry, fresh CONTEXT.
    "datadome": Profile(
        name="datadome",
        retries=3,
        warmup_wait_ms=4000,
        settle_wait_ms=5000,
        block_pat=BLOCK_PAT,
    ),
}


def uses_fresh_browser(adapter: Adapter) -> bool:
    """Does this adapter launch a FULL Chromium PROCESS per attempt (vs a cheap
    new_context on a pooled browser)? L1 needs this to size the OOM gate: a
    fresh-browser task costs a whole renderer/GPU/zygote heap, NOT one context,
    so L1 charges it more gate permits. Resolving the profile here keeps the
    profile REGISTRY in L2 (L1 never reaches into PROFILES)."""
    return _resolve(adapter.defense).fresh_browser_per_attempt


def _resolve(defense: Optional[Defense]) -> Profile:
    """Merge an adapter's Defense (named profile + overrides) into one effective
    Profile. None -> the 'none' profile. Each override that is not None replaces
    that one knob; None means "inherit the profile default" (NOT zero)."""
    if defense is None:
        return PROFILES["none"]
    base = PROFILES.get(defense.profile, PROFILES["none"])
    over: dict[str, Any] = {}
    if defense.warmup_url is not None:
        over["warmup_url"] = defense.warmup_url
    if defense.retries is not None:
        over["retries"] = defense.retries
    if defense.warmup_wait_ms is not None:
        over["warmup_wait_ms"] = defense.warmup_wait_ms
    if defense.settle_wait_ms is not None:
        over["settle_wait_ms"] = defense.settle_wait_ms
    if defense.min_body_len is not None:
        over["min_body_len"] = defense.min_body_len
    if defense.block_resources is not None:
        over["block_resources"] = defense.block_resources
    if defense.fresh_browser_per_attempt is not None:
        over["fresh_browser_per_attempt"] = defense.fresh_browser_per_attempt
    return replace(base, **over) if over else base


# ---------------------------------------------------------------------------
# Low-level page helpers (async ports of the old _* helpers).
# ---------------------------------------------------------------------------


async def _block_heavy_resources(page) -> None:
    """Abort image/media to save RAM/bandwidth (old _block_heavy_resources).
    Only called when the resolved profile.block_resources is True (FIX #2)."""
    async def on_route(route):
        try:
            if route.request.resource_type in ("image", "media"):
                await route.abort()
                return
        except Exception:
            pass
        await route.continue_()

    await page.route("**/*", on_route)


async def _wait_for_xhr_quiet(page, seen_count, timeout_ms: int = 8000, quiet_ms: int = 800) -> None:
    """Wait until the XHR counter stops growing for quiet_ms, or timeout.
    seen_count() is a 0-arg callable -> int (old _wait_for_xhr_quiet)."""
    deadline = time.monotonic() + timeout_ms / 1000
    last = -1
    quiet_since: Optional[float] = None
    while time.monotonic() < deadline:
        count = seen_count()
        if count and count == last:
            if quiet_since is None:
                quiet_since = time.monotonic()
            elif (time.monotonic() - quiet_since) * 1000 >= quiet_ms:
                return
        else:
            last = count
            quiet_since = None
        await page.wait_for_timeout(100)


async def _goto_swallow(page, url: str, wait_ms: int, wait_until: str = "domcontentloaded") -> None:
    """goto that swallows nav timeouts (old `try: p.goto(...) except: pass`)."""
    try:
        await page.goto(url, wait_until=wait_until, timeout=wait_ms)
    except Exception:
        pass


async def _body_text(page) -> str:
    try:
        return " ".join((await page.inner_text("body") or "").split())
    except Exception:
        return ""


def _is_blocked(text: str, prof: Profile) -> bool:
    """block = profile's block_pat hit OR (opt-in) body shorter than min_body_len.
    min_body_len default 0 means a legit short 'no results' page is NOT a false
    block (FIX #4)."""
    return bool(prof.block_pat.search(text[:3000])) or (
        prof.min_body_len > 0 and len(text) < prof.min_body_len)


# ---------------------------------------------------------------------------
# ScriptCtx — the script-mode escape hatch handed to the adapter.
# ---------------------------------------------------------------------------


@dataclass
class ScriptCtx:
    """What a mode='script' adapter's extract(ctx, part) receives. The defense
    profile has ALREADY warmed up (seeding PX/Akamai cookies in this context),
    but it has NOT navigated to the search URL — the adapter owns EVERY goto,
    including the first one. This is what lets sager/jbchip, whose data XHR fires
    on the FIRST navigation, install a response listener BEFORE that goto instead
    of doing a wasted redundant second goto. It gets:

      page      — the LIVE post-warmup Playwright async Page (same context that
                  cleared the warmup wall; cookies seeded; NOT yet on the search
                  URL — the adapter's first goto goes there).
      goto      — async helper: goto(url) -> body text, swallowing nav timeouts,
                  using the same wait budget. The adapter chooses what to do with
                  the text (e.g. its own per-hop block check).
      on_response — wire a page.on('response') sniffer for URLs containing
                  `needle` BEFORE the adapter's first goto. Returns a 0-arg
                  callable -> list of captured Response objects (newest last).
                  This is the FIRST-navigation XHR capture point (sager:
                  ccstore inventories/prices/skus; jbchip: /api/item/goods/v1).
      block_pat — the profile's compiled block regex, so the adapter can run the
                  SAME block check at each hop (octopart-alt does this).
      wait_ms   — the per-nav timeout budget, for the adapter's own gotos.

    The adapter returns list[Row] directly (it is async). It does NOT close the
    page/context/browser — L1 owns lifecycle and closes them after extract."""
    page: Any
    block_pat: Pattern
    wait_ms: int

    async def goto(self, url: str) -> str:
        """Navigate (swallowing timeouts) and return the body text."""
        await _goto_swallow(self.page, url, self.wait_ms)
        return await _body_text(self.page)

    def on_response(self, needle: str) -> Any:
        """Attach a response sniffer for URLs containing `needle` and return a
        0-arg getter -> list[Response]. Wire this BEFORE the first goto so the
        XHR that fires on initial navigation (sager/jbchip) is not missed."""
        captured: list = []

        def _on(r, _needle=needle, _cap=captured):
            if _needle and _needle in r.url:
                _cap.append(r)

        self.page.on("response", _on)
        return lambda: captured

    def blocked(self, text: str) -> bool:
        """Run the profile's block_pat against `text[:3000]`."""
        return bool(self.block_pat.search(text[:3000]))


# ---------------------------------------------------------------------------
# navigate — THE one place the warmup+retry anti-bot loop lives.
# ---------------------------------------------------------------------------


async def navigate(pool, adapter: Adapter, part: str, *, wait_ms: int):
    """Get a page past the adapter's defense wall and return what extract needs.

    Returns (payload, ctx, meta):
      payload — depends on mode:
                 dom    -> the live Page
                 xhr    -> parsed JSON of the first match_xhr response (or None)
                 script -> a ScriptCtx, positioned at the WARMED page (cookies
                           seeded) but NOT yet on the search URL: the adapter
                           owns every goto (so it can wire ctx.on_response before
                           its first nav) and runs its own per-hop block check via
                           ctx.blocked(). L2 does NOT consume the search goto in
                           script mode, hence no forced double-goto. Script mode
                           does not retry in L2 (no search page to block-check);
                           the adapter handles its own per-hop failures.
                None payload signals "blocked / nothing captured after retries";
                L1 emits a blocked sentinel Row.
      ctx     — the live context to close (L1 owns closing). None when exhausted.
      meta    — {"blocked": bool, "url": str}; when a per-attempt browser was
                launched (fresh_browser_per_attempt), meta["_owned_browser"] holds
                it so L1 closes it after extract.

    The retry RESET: fresh CONTEXT by default; a fresh BROWSER PROCESS per attempt
    when the resolved profile sets fresh_browser_per_attempt (FIX #3 — the only
    reset that clears intermittent PerimeterX; a new context shares
    process/TLS/fingerprint)."""
    prof = _resolve(adapter.defense)
    attempts = max(1, prof.retries)
    fresh_browser = prof.fresh_browser_per_attempt

    pooled = None
    if not fresh_browser:
        pooled = await pool.get(adapter.needs_proxy)

    last_meta = {"blocked": True, "url": adapter.url(part)}
    for _ in range(attempts):
        browser = await pool.fresh(adapter.needs_proxy) if fresh_browser else pooled
        ctx = await browser.new_context()
        try:
            page = await ctx.new_page()
            if prof.block_resources:               # FIX #2: off unless opted in
                await _block_heavy_resources(page)

            # xhr mode: install the response sniffer BEFORE navigating.
            seen: list = []
            captured: list = []
            if adapter.mode == "xhr":
                needle = adapter.match_xhr or ""

                def on_resp(r, _needle=needle, _seen=seen, _cap=captured):
                    if _needle and _needle in r.url:
                        _seen.append(1)
                        _cap.append(r)

                page.on("response", on_resp)

            # ① optional warmup (seed PX/Akamai/DataDome cookie in this context)
            if prof.warmup_url:
                await _goto_swallow(page, prof.warmup_url, wait_ms)
                await page.wait_for_timeout(prof.warmup_wait_ms)

            # ---- script: DO NOT consume the search goto. Hand the warmed page
            # over with the wall cookies seeded; the adapter owns EVERY goto so it
            # can attach page.on('response') (ctx.on_response) BEFORE its first
            # navigation — the capture point sager/jbchip need (their data XHR
            # fires on the first nav). The adapter runs its own per-hop block
            # check via ctx.blocked(); L2 does not pre-navigate, so no double
            # goto / doubled PX exposure. (xhr/dom still get ② below.) ----
            if adapter.mode == "script":
                sctx = ScriptCtx(page=page, block_pat=prof.block_pat, wait_ms=wait_ms)
                meta = {"blocked": False, "url": page.url}
                if fresh_browser:
                    meta["_owned_browser"] = browser
                return sctx, ctx, meta

            # ② the real navigation past the wall (xhr/dom only)
            await _goto_swallow(page, adapter.url(part), wait_ms)

            # ---- xhr: capture the matching JSON ----
            if adapter.mode == "xhr":
                await _wait_for_xhr_quiet(page, lambda: len(seen), min(wait_ms, 10000))
                payload = None
                for r in captured:
                    try:
                        payload = await r.json()
                        break
                    except Exception:
                        continue
                meta = {"blocked": payload is None, "url": page.url}
                if fresh_browser:
                    meta["_owned_browser"] = browser
                return payload, ctx, meta

            # ---- dom: settle, block-check, hand the live page to extract ----
            await page.wait_for_timeout(prof.settle_wait_ms)
            text = await _body_text(page)
            blocked = _is_blocked(text, prof)
            meta = {"blocked": blocked, "url": page.url}
            if blocked and adapter.defense is not None:
                last_meta = meta
                await ctx.close()
                if fresh_browser:
                    try:
                        await browser.close()
                    except Exception:
                        pass
                continue
            if fresh_browser:
                meta["_owned_browser"] = browser
            return page, ctx, meta
        except Exception:
            try:
                await ctx.close()
            except Exception:
                pass
            if fresh_browser:
                try:
                    await browser.close()
                except Exception:
                    pass
            raise
    # exhausted retries — L1 emits a blocked Row.
    return None, None, last_meta


__all__ = [
    "BLOCK_PAT", "PX_BLOCK_PAT",
    "Profile", "PROFILES", "ScriptCtx",
    "navigate", "uses_fresh_browser",
]
