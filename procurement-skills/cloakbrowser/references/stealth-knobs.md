# Stealth knobs

Stealth is binary-level by default — `launch()` already produces a Chrome-shaped
fingerprint. These knobs cover the cases where the default isn't enough.

## `humanize=True`

Adds human-like input behaviour: Bézier mouse curves, per-character keyboard
timing, organic scroll patterns.

Turn on when:

- The target has **behavioural** detection (Cloudflare Turnstile managed
  challenge, reCAPTCHA v3, ShieldSquare, PerimeterX).
- You're going to click/type — not just `goto` and read.

Leave off when:

- Plain HTML scrape of an unprotected site. `humanize` adds latency for no win.

## Proxies

Pass `proxy="scheme://user:pass@host:port"`. Supports `http`, `https`, `socks5`.

- **`geoip=True`** — resolves the proxy exit IP and auto-picks matching
  timezone, locale, and WebRTC ICE IP. Use whenever the proxy lands you in a
  different country than the host. Stops the "timezone says Berlin, IP says
  Tokyo" tell.
- Residential / mobile proxies pass behavioural checks far better than
  datacentre proxies. If the target blocks despite `humanize=True`, the proxy
  is usually the cause, not the browser.

## Persistent profiles

For sites that fingerprint based on cookies / localStorage continuity (most
account-protected sites do), use:

```python
from cloakbrowser import launch_persistent_context
ctx = launch_persistent_context("/root/.cloakbrowser-profiles/<name>")
```

The profile dir holds cookies, storage, and a stable fingerprint seed so the
device looks the same across runs. One profile per identity — never share a
profile across accounts on the same target.

## CDP server mode

`scripts/serve.sh` starts `python -m cloakbrowser.serve` in the background.
Other tools connect via Playwright's `connect_over_cdp`:

```python
from playwright.sync_api import sync_playwright
pw = sync_playwright().start()
browser = pw.chromium.connect_over_cdp("http://127.0.0.1:9222")
```

Use this when:

- A long-running agent needs many tool calls against the same logged-in session.
- Multiple skills need to share one stealth Chromium (saves the ~10 s startup).

Don't use it for one-shot fetches — `scripts/fetch.py` is simpler and
spin-up cost is dominated by the page load anyway.

## Verifying stealth

`scripts/check-stealth.py` runs the four core fingerprint checks (webdriver,
plugins, window.chrome, UA). For a thorough check against real detection
services, navigate to one of these and screenshot the result:

- `https://bot.sannysoft.com/`
- `https://browserscan.net/`
- `https://abrahamjuliot.github.io/creepjs/`
- `https://fingerprint.com/products/bot-detection/`

If a real target still blocks, the order of operations is:
1. add `--humanize`
2. add a residential proxy with `--geoip`
3. switch to a persistent profile and warm it manually (visit a few pages
   logged out, accept cookies, then come back to do the work)
