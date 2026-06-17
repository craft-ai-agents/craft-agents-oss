#!/usr/local/bin/cloakbrowser-python
"""Fetch a URL with stealth Chromium and print HTML or extracted text.

Usage:
    fetch.py URL [--text] [--wait STATE] [--timeout MS] [--humanize]
                 [--proxy URL] [--geoip] [--selector CSS]
"""
import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("url")
    ap.add_argument("--text", action="store_true",
                    help="Print visible text (innerText of body) instead of HTML")
    ap.add_argument("--selector",
                    help="CSS selector to scope the output; default is full body/page")
    ap.add_argument("--wait", default="domcontentloaded",
                    choices=["load", "domcontentloaded", "networkidle", "commit"],
                    help="Playwright wait_until state (default: domcontentloaded)")
    ap.add_argument("--timeout", type=int, default=30000,
                    help="Navigation timeout in ms (default: 30000)")
    ap.add_argument("--humanize", action="store_true",
                    help="Enable behavioural stealth (slower; use for Cloudflare/Turnstile)")
    ap.add_argument("--proxy", help="Proxy URL, e.g. http://u:p@host:port or socks5://...")
    ap.add_argument("--geoip", action="store_true",
                    help="Auto-pick timezone/locale from proxy exit IP (needs --proxy)")
    args = ap.parse_args()

    from cloakbrowser import launch

    launch_kwargs = {"headless": True, "humanize": args.humanize}
    if args.proxy:
        launch_kwargs["proxy"] = args.proxy
    if args.geoip:
        launch_kwargs["geoip"] = True

    browser = launch(**launch_kwargs)
    try:
        page = browser.new_page()
        page.goto(args.url, wait_until=args.wait, timeout=args.timeout)
        if args.selector:
            el = page.query_selector(args.selector)
            if not el:
                print(f"selector not found: {args.selector}", file=sys.stderr)
                return 2
            sys.stdout.write(el.inner_text() if args.text else el.inner_html())
        else:
            sys.stdout.write(page.inner_text("body") if args.text else page.content())
        sys.stdout.write("\n")
    finally:
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
