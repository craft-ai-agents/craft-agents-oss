#!/usr/local/bin/cloakbrowser-python
"""Open a URL in stealth Chromium and evaluate a JS expression. Prints JSON.

Usage:
    eval-js.py URL "JS_EXPRESSION" [--wait STATE] [--humanize]
                                   [--proxy URL] [--geoip]

The JS expression must be a single expression that returns a JSON-serializable value.
Wrap multi-statement logic in an IIFE: "(() => { ...; return foo; })()"
"""
import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("url")
    ap.add_argument("expr", help="JS expression returning a JSON-serializable value")
    ap.add_argument("--wait", default="domcontentloaded",
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
        page = browser.new_page()
        page.goto(args.url, wait_until=args.wait, timeout=args.timeout)
        value = page.evaluate(args.expr)
        json.dump(value, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
    finally:
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
