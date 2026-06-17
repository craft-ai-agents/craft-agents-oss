#!/usr/local/bin/cloakbrowser-python
"""Save a URL as PDF with stealth Chromium (Chromium-only, headless).

Usage:
    pdf.py URL OUTPUT.pdf [--format A4|Letter] [--landscape]
                          [--wait STATE] [--humanize] [--proxy URL] [--geoip]
"""
import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("url")
    ap.add_argument("output")
    ap.add_argument("--format", default="A4")
    ap.add_argument("--landscape", action="store_true")
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
        page = browser.new_page()
        page.goto(args.url, wait_until=args.wait, timeout=args.timeout)
        page.pdf(path=args.output, format=args.format, landscape=args.landscape)
        print(args.output)
    finally:
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
