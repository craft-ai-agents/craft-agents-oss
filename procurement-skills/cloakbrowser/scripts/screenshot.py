#!/usr/local/bin/cloakbrowser-python
"""Screenshot a URL with stealth Chromium.

Usage:
    screenshot.py URL OUTPUT.png [--full] [--selector CSS] [--viewport WxH]
                                 [--wait STATE] [--humanize] [--proxy URL] [--geoip]
"""
import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("url")
    ap.add_argument("output")
    ap.add_argument("--full", action="store_true", help="Full-page screenshot")
    ap.add_argument("--selector", help="CSS selector to crop the screenshot to")
    ap.add_argument("--viewport", help="Viewport size WxH, e.g. 1440x900")
    ap.add_argument("--wait", default="networkidle",
                    choices=["load", "domcontentloaded", "networkidle", "commit"])
    ap.add_argument("--timeout", type=int, default=30000)
    ap.add_argument("--humanize", action="store_true")
    ap.add_argument("--proxy")
    ap.add_argument("--geoip", action="store_true")
    args = ap.parse_args()

    from cloakbrowser import launch

    launch_kwargs = {"headless": True, "humanize": args.humanize}
    if args.proxy:
        launch_kwargs["proxy"] = args.proxy
    if args.geoip:
        launch_kwargs["geoip"] = True

    browser = launch(**launch_kwargs)
    try:
        ctx_kwargs = {}
        if args.viewport:
            w, h = args.viewport.lower().split("x")
            ctx_kwargs["viewport"] = {"width": int(w), "height": int(h)}
        ctx = browser.new_context(**ctx_kwargs) if ctx_kwargs else browser
        page = ctx.new_page()
        page.goto(args.url, wait_until=args.wait, timeout=args.timeout)

        if args.selector:
            el = page.query_selector(args.selector)
            if not el:
                print(f"selector not found: {args.selector}", file=sys.stderr)
                return 2
            el.screenshot(path=args.output)
        else:
            page.screenshot(path=args.output, full_page=args.full)
        print(args.output)
    finally:
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
