# CUTOVER — old per-skill scrape scripts → 3-layer scrape-engine

**Non-destructive migration. The old scripts STAY as a working fallback.**

The engine's anti-bot / residential-proxy path is **not yet validated on the
4C4G prod box**. Until a prod smoke test of that path passes (see
[Cutover gate](#cutover-gate)), every skill keeps calling the old scripts for
the proxy/anti-bot sources, and the old scripts are **NOT deleted**. The engine
is wired in *additively*: direct-path sources can move first, proxy/anti-bot
sources move only after the gate clears.

Engine CLI (always via the cloakbrowser venv python):

```bash
cloakbrowser-python /home/cunningham/Projects/craft-agents-oss/procurement-skills/scrape-engine/engine.py \
    --parts "A,B" --source <ids> --gate N      # batch
cloakbrowser-python .../engine.py --part "A" --source <ids>   # single (back-compat)
```

`--gate N` = global OOM-bounded concurrency (4C4G: keep small, 2 is the tested
default). `--source` = csv of adapter ids; omit to fan out over all 34.

---

## 1. Invocation map — old script → new engine

### procurement-platform-search (core four)

| Old invocation | New engine equivalent | Path class |
|---|---|---|
| `scripts/api_search.py --part P` (digikey+mouser) | `engine.py --part P --source digikey,mouser` | API-mode (creds) — **PROD-GATED** |
| `scripts/api_search.py --part P --source digikey` | `engine.py --part P --source digikey` | API-mode (creds) — **PROD-GATED** |
| `scripts/cloak_search.py --part P` (ickey+master) | `engine.py --part P --source ickey,master` | mixed: ickey direct / master proxy |
| `scripts/cloak_search.py --part P --source ickey-replace` | `engine.py --part P --source ickey-replace` | xhr direct (替代料) |
| — (master only) | `engine.py --part P --source master` | dom + Akamai + proxy — **PROD-GATED** |
| — (ickey only) | `engine.py --part P --source ickey` | xhr, 境内直连 — direct |

### procurement-platform-search-more (extended sources)

| Old invocation | New engine equivalent | Path class |
|---|---|---|
| `scripts/api_search.py --part P --source vanlinkon` | `engine.py --part P --source vanlinkon` *(not yet ported — keep old script)* | API direct |
| `scripts/api_search.py --part P --source element14` | **dropped** → `--source element14-cn` (portal API dead) | dom direct |
| `scripts/cloak_search.py --part P --source future,newark` | `engine.py --part P --source future,newark` | generic dom (newark=proxy) |
| `scripts/cloak_search.py --part P --source octopart` | `engine.py --part P --source octopart` | script + PerimeterX — **PROD-GATED** |
| `scripts/cloak_search.py --part P --source octopart-alt` | `engine.py --part P --source octopart-alt` | script + PerimeterX — **PROD-GATED** |
| `scripts/cloak_search.py --part P --source verical` | `engine.py --part P --source verical` | xhr direct |
| `scripts/cloak_search.py --part P --source element14-cn` | `engine.py --part P --source element14-cn` | script direct, RMB tiers |
| `scripts/cloak_search.py --part P --source avnet` | `engine.py --part P --source avnet` | dom + PerimeterX + proxy — **PROD-GATED** |
| `scripts/cloak_search.py --part P --source rs-us,tti` | `engine.py --part P --source rs-us,tti` | datadome/px + proxy — **PROD-GATED** |
| `scripts/cloak_search.py --part P --source <other site>` | `engine.py --part P --source <same id>` | per id below |

Source ids are unchanged across the cut — the old `--source` values map 1:1 to
engine adapter ids (the one exception is `element14` → `element14-cn`, which was
already the live skill's documented redirect).

---

## 2. What is LIVE-VERIFIED vs PROD-GATED

The split is by **network path**, not by skill. The direct path (machine-direct
/ 境内直连, no residential proxy, no anti-bot wall) is exercised and trusted. The
proxy / anti-bot path and the credentialed API path are **gated** behind a prod
smoke test on the 4C4G box.

### ✅ LIVE-VERIFIED (direct path — safe to cut over now)

- **Concurrency engine** — the OOM-bounded weighted gate, per-host serialization
  (站内串行/站间并行), and `run_batch` scheduler. Measured **~1.8× throughput**
  over the old serial-per-script model at `--gate 2` on a multi-source batch,
  with no OOM.
- **`szlcsc-overseas`** — script-mode meta-aggregator, `so.szlcsc.com/global`,
  境内直连, no anti-bot. Structured tiered USD/RMB price breaks. Verified live.
- **`octopart`** *(direct-IP variant, `needs_proxy=False`)* — script-mode XHR
  intercept of the Nexar SPA API. Verified clearing the wall from a direct IP.
  ⚠ If the prod IP gets PX-blacklisted this flips to the **PROD-GATED** column
  (set `needs_proxy=True`).
- **New first-class adapters** (script-mode, structured, direct): the
  `szlcsc-overseas`, `octopart`, `octopart-alt`, and `element14-cn` rewrites that
  replaced the old raw-body-dump generics — these parse structured fields rather
  than dumping `inner_text`.
- **Direct-path generic / xhr adapters** (`needs_proxy=False`): `ickey`,
  `ickey-replace`, `verical`, `element14-cn`, `lcsc`, `szlcsc`, `future`,
  `corestaff`, `darisus`, `monotaro`, `misumi`, `misumi-jp`, `heilind`, `sager`,
  `rochester`, `jbchip`. Import + register + schedule clean; direct egress.

### ⛔ PROD-GATED (do NOT trust until the prod smoke test passes — keep old scripts)

- **Anti-bot / residential-proxy path** — every adapter with `needs_proxy=True`
  and/or a `defense` profile of `perimeterx` / `akamai` / `datadome`. The warmup
  → goto → block-check → fresh-Chromium-retry loop and the mihomo residential
  egress are **unvalidated on the prod box**. Affected ids: `master` (akamai),
  `avnet` (perimeterx), `octopart-alt` (perimeterx), `tti` (perimeterx),
  `rs-us` (datadome), `octopart` *if PX-blacklisted*, plus all `needs_proxy=True`
  generics (`arrow`, `newark`, `componentonline`, `peigenesis`, `rs-uk`, `rs-jp`,
  `rs-hk`, `tme`, `xonelec`).
- **API-mode `digikey` / `mouser`** — need `DIGIKEY_CLIENT_ID` /
  `DIGIKEY_CLIENT_SECRET` / `MOUSER_API_KEY` from `/etc/craft-agent.env` and
  overseas egress via the mihomo proxy. Credential + proxy egress unverified
  through the engine path; old `api_search.py` is the trusted fallback.
- **De-scoped / assumption-flipped ports** — `octopart-alt` (old 4-round
  fresh-Chromium retry NOT ported — single attempt then blocked sentinel),
  `jbchip` (second-nav XHR timing unverified), `misumi-jp` (old script marked
  needs-residential-proxy; ported as `needs_proxy=False`).

Everything in this round was relocated **byte-faithfully** from the old scripts
but **not re-run against live sites** for the proxy/anti-bot path. Treat the
per-adapter table in `README.md` as a *port manifest*, not a pass certification.

---

## Cutover gate

> **Retire the old scripts ONLY after a prod smoke test of the proxy / anti-bot
> path passes on the 4C4G box.**

Concretely, before deleting `api_search.py` / `cloak_search.py` from either
skill, ALL of the following must pass **on prod (real network, real mihomo
proxy)**:

1. **API path:** `engine.py --part LM358 --source digikey,mouser` returns real
   rows with the `/etc/craft-agent.env` creds + proxy egress.
2. **Akamai proxy path:** `engine.py --part <relay/passive> --source master`
   clears the wall and returns rows (not a `blocked=true` sentinel).
3. **PerimeterX warmup path:** `engine.py --part LM358DR2G --source avnet`
   (and `--source octopart`) returns rows via the warmup+retry loop.
4. **DataDome proxy path:** `engine.py --part <P> --source rs-us` returns rows.
5. **OOM stability:** the above run together at `--gate 2` without the box OOMing
   (verify against the budget in `README.md` §"The OOM budget").

Until then:

- The engine is used **additively** for the LIVE-VERIFIED direct-path sources.
- The skills keep calling the **old scripts** for the PROD-GATED sources.
- **No old script is deleted.** They remain the fallback for the entire
  proxy/anti-bot/API path and are the rollback target if the engine regresses.

Rollback = stop passing the gated `--source` ids to the engine; the old scripts
are untouched and immediately usable.
