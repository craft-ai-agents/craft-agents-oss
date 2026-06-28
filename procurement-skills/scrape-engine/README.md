# scrape-engine — 3-layer async procurement scraper

> **STATUS OF THIS ROUND — read first, honestly.**
>
> This round delivered the **concurrency engine** (the 3-layer split, the
> OOM-bounded gate, the per-host serialization, the warmup/retry anti-bot loop,
> the script escape-hatch) **plus the AS-IS port of 34 adapters** from the old
> per-site `cloak_search.py` scripts into that engine.
>
> What is **validated** this round: every adapter **imports and registers**
> cleanly; the registry collects all **34** ids; the batch **task graph and
> per-host lock grouping** build with **zero scheduling / duplicate-host /
> registration errors** (offline, no network — see `Schedule check` below).
>
> What is **NOT validated** this round, and must not be assumed working:
>
> - **Per-site business-logic correctness** — whether each adapter's `extract()`
>   actually returns the right rows / fields / text for a real query. The ports
>   were relocated byte-faithfully from the old scripts; they were **not**
>   re-run against the live sites to confirm the parsing still matches today's
>   markup/JSON. The 16 generic adapters in particular dump raw body text into
>   `Row.note` and were *intentionally* not correctness-checked.
> - **Live anti-bot behavior** — whether PerimeterX / Akamai / DataDome warmup +
>   retry actually clears the wall today, whether the residential proxy still
>   egresses where expected, and whether the datacenter-IP "machine-direct"
>   assumptions (`needs_proxy=False`) still hold. These were true in the old
>   scripts' notes; they are time-sensitive and unverified here.
>
> **A production smoke test (real network, real proxy) is required before any of
> this is trusted.** Treat the per-adapter table below as a *port manifest*, not
> a pass/fail certification.

---

## The three layers

The stack is a strict one-way dependency: `L1 → L2 → L3`. Each layer owns one
concern and knows nothing about the layers above it.

| Layer | File | Owns | Knows NOTHING about |
|-------|------|------|---------------------|
| **L1 — resource** (hardware / deploy) | `resource.py` | `BrowserPool` (one proxy browser + one machine-direct browser, launched once, reused), the env-proxy strip, `.fresh()` full-Chromium relaunch, the asyncio concurrency **gate** (OOM-bounded, weighted permits), the per-host **locks** (站内串行 / 站间并行), context lifecycle, and `run_batch` (the scheduler). | *why* a page is blocked; what a part is |
| **L2 — antibot** (adversary) | `antibot.py` | `navigate()` — the warmup → goto → block-check → retry loop; the named defense **PROFILES** (`none`/`direct`/`perimeterx`/`akamai`/`datadome`); the block regexes; the **script escape-hatch** (`ScriptCtx`). | RAM, proxy buckets, scheduling; a site's grid |
| **L3 — contract** (types only) | `contract.py` | `Row`, `Defense`, `Adapter`. Pure dataclasses. Imports nothing from L1/L2. | everything else — it is the bottom |

Adapters (`adapters/*.py`) sit on top: each is a **pure description** of one
site in one mode. An adapter owns NO browser, NO proxy, NO retry loop, NO
warmup — it only declares the URL, how to turn a payload into `Row`s, which
defense profile to use, and (script mode) how to drive the live page.

`source_catalog.yaml` is the static platform catalog: business display names,
channel types, category fit, aggregator coverage, and known access limitations.
It is not a live pass/fail report; live availability still comes from each
engine run's `rows` / `errors` / `blocked` output.

`registry.py` collects every `adapters/*.py` exposing a top-level `ADAPTER`
into a flat `id → Adapter` dict. `engine.py` is the CLI front door + a couple of
re-exports; it owns no mechanics.

### The OOM budget (why the gate is weighted)

A 4C4G box is OOM-bound. A `fresh()` task launches a **whole Chromium process**
(perimeterx, per attempt), not a cheap new context — so it charges
`FRESH_BROWSER_PERMITS` (=2) gate permits, not 1. The operator invariant before
raising `--gate`:

```
2 * BASE_RSS + ceil(gate / FRESH_BROWSER_PERMITS) * FRESH_BROWSER_RSS  <  RAM
```

`DEFAULT_GATE=2` ⇒ at most **one** fresh full process at a time alongside the 2
pooled browsers = 3 heavy Chromiums, which fits 4G.

---

## The mode list

`mode` decides what `extract(payload, part)` receives — **not** whether the
result is structured. (Structure is decided by what the adapter actually parses:
a real in-page JSON API can fill typed fields; a body-text scrape cannot.)

| mode | `payload` is… | extract | browser? | typical structure |
|------|---------------|---------|----------|--------------------|
| **api** | parsed JSON from the adapter's own `api_fetch(part, limit)` | sync | none | **structured** Rows |
| **xhr** | parsed JSON of the first response whose URL contains `match_xhr` (L2 sniffs it) | sync | yes (L2 drives) | **structured** Rows |
| **dom** | the live Playwright Page, already warmed/retried/settled past the wall | `async` | yes (L2 drives) | usually a **body dump** → raw text in `Row.note` |
| **script** | a `ScriptCtx` (warmed Page **not** yet on the search URL + helpers); the adapter owns **every** goto | `async` | yes (adapter drives) | depends — in-page JSON API ⇒ structured; body scrape ⇒ `note` |

`script` is the escape hatch for the sites the 3 simple modes can't express
(data XHR fires on the first/second nav; multi-hop auth fetch; in-page token
read). L2 runs only the profile warmup, then hands the adapter the warmed page
so it can wire `ctx.on_response(needle)` **before** its first goto.

### Defense profiles (L2)

| profile | flow | retries | reset | shared by |
|---------|------|---------|-------|-----------|
| `none` | single goto, generic `BLOCK_PAT` check, no retry/warmup | 1 | — | all generic dom, ocpneumatics |
| `direct` | == `none`, but documents "must be machine-direct" | 1 | — | (policy marker) |
| `perimeterx` | homepage warmup → seed PX cookie → goto → block-check → retry **with a fresh Chromium process per attempt** | 4 | full process | avnet, octopart, octopart-alt, tti |
| `akamai` | homepage warmup → goto → block-check → retry (fresh context) | 3 | fresh context | master |
| `datadome` | homepage warmup → goto → block-check → retry (fresh context) | 3 | fresh context | rs-us |

`Defense(profile=...)` may override individual knobs (`warmup_url`, `retries`,
`min_body_len`, …); `None` on an override means "inherit the profile default",
not zero.

---

## Per-adapter manifest

`needs_proxy=True` ⇒ L1 routes it through the residential proxy bucket (mihomo);
`False` ⇒ the machine-direct bucket. `defense` is the resolved profile (`none`
when no `Defense`). Two host-keys are intentionally **shared** so same-site hits
serialize: `octopart.com` (octopart + octopart-alt) and `search.ickey.cn`
(ickey + ickey-replace).

### Layer A — the 3 reference adapters

| id | mode | needs_proxy | defense | structure | fidelity caveat |
|----|------|-------------|---------|-----------|-----------------|
| digikey | api | yes | none (OAuth, no browser) | structured | — (reference) |
| ickey | xhr | no | none | structured | — (reference) |
| avnet | dom | yes | perimeterx (own warmup_url, min_body_len=80) | body dump → `note` | live PX behavior unverified |

### Layer B — the 15 bespoke ports

| id | mode | needs_proxy | defense | structure | fidelity caveat |
|----|------|-------------|---------|-----------|-----------------|
| mouser | api | yes | none | structured | — |
| ickey-replace | xhr | no | none | structured | shares ickey host (serialized) |
| misumi | xhr | no | none | structured | — |
| misumi-jp | xhr | no | none | structured | **⚠ proxy assumption** — old script marked 🔒 needs residential proxy; ported as `needs_proxy=False` (datacenter-direct). Flip to `True` if prod blocks. |
| verical | xhr | no | none | structured | datacenter-direct assumption unverified |
| rs-us | xhr | yes | datadome | structured | live DataDome behavior unverified |
| master | dom | yes | akamai | body dump → `note` | live Akamai behavior unverified |
| octopart | dom | yes | perimeterx | body dump → `note` | live PX behavior unverified |
| tti | dom | yes | perimeterx | body dump → `note` | live PX behavior unverified |
| heilind | script | no | none | structured (in-page Coveo JSON) | in-page token read unverified |
| sager | script | no | none | structured (ccstore JSON on first nav) | first-nav XHR capture unverified |
| rochester | script | no | none | structured (in-page authed fetch) | multi-hop fetch unverified |
| ocpneumatics | script | no | none | structured (meilisearch JSON) | hardcoded public Bearer token may rotate |
| jbchip | script | no | none | body dump → `note` | **⚠ second-nav timing** — data XHR fires only on the SECOND nav after Vue Router boots; capture timing unverified live |
| octopart-alt | script | yes | perimeterx | body dump → `note` | **⚠ de-scoped retry** — old 4-round fresh-Chromium retry NOT ported; runs ONE multi-hop attempt, then a blocked sentinel. Warmup+proxy survive; 4× relaunch does not. |

### Layer C — the 16 generic SSR-dump adapters

All built by `adapters/_generic.make_generic` — `mode=dom`, `defense=none`
(single goto, generic block check, settle 4s), body text → `Row.note`. **None
are structured; extraction correctness was intentionally NOT verified this
round** (raw text for the agent to re-parse downstream).

| id | needs_proxy | host |
|----|-------------|------|
| arrow | yes | www.arrow.com |
| componentonline | yes | www.componentonline.com |
| newark | yes | www.newark.com |
| peigenesis | yes | www.peigenesis.com |
| rs-hk | yes | hken.rs-online.com |
| rs-jp | yes | jp.rs-online.com |
| rs-uk | yes | uk.rs-online.com |
| tme | yes | www.tme.eu |
| xonelec | yes | www.xonelec.com |
| corestaff | no | www.zaikostore.com |
| darisus | no | shop.darisusgmbh.de |
| element14-cn | no | cn.element14.com |
| future | no | www.futureelectronics.com |
| lcsc | no | www.lcsc.com |
| monotaro | no | www.monotaro.com |
| szlcsc | no | so.szlcsc.com |

---

## Honest import + register status

| | count | status |
|--|-------|--------|
| 3 references + 15 bespoke + 16 generic | **34** | all **import + register cleanly** |
| import failures | 0 | — |
| schedule / duplicate-host failures | 0 | two shared host-keys are intentional, not collisions |

Every one of the 34 imports without error, exposes a valid `Adapter`, has a
callable `url()`, resolves its defense profile, satisfies its mode's required
fields (`xhr` ⇒ `match_xhr`, `api` ⇒ `api_fetch`), and lands in exactly one
host-lock group. The **explicit** module list in `registry.py` now equals the
directory **scan** (parity), so a missing adapter would fail loud rather than
vanish silently.

The "fidelity caveat" column above flags **business-logic / live-antibot
risk**, which import-success does **not** cover. Adapters carrying a caveat:
`avnet`, `mouser`(*), `ickey-replace`, `misumi-jp`, `verical`, `rs-us`,
`master`, `octopart`, `tti`, `heilind`, `sager`, `rochester`, `ocpneumatics`,
`jbchip`, `octopart-alt`, and all 16 generic adapters. The three with an
explicit **de-scope or assumption flip** (⚠) are `misumi-jp` (proxy assumption),
`jbchip` (second-nav timing), and `octopart-alt` (4× retry not ported).

(*) `mouser`/`digikey` are API adapters with no browser; their only risk is
credentials/quotas, not anti-bot.

---

## Running

```bash
# registry / schedule check (offline, no network)
/usr/local/bin/cloakbrowser-python -c "import registry; print(len(registry.all_ids()), sorted(registry.all_ids()))"

# real run (network) — single part, all sources
/usr/local/bin/cloakbrowser-python engine.py --part LM358

# subset of sources, multiple parts
/usr/local/bin/cloakbrowser-python engine.py --parts LM358,NE555 --source digikey,ickey,mouser --gate 2
```

`cloakbrowser` lives only in the uv-tool venv — always use
`/usr/local/bin/cloakbrowser-python` (or the bundled scripts), never the system
Python.
