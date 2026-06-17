#!/usr/local/bin/cloakbrowser-python
"""Long-lived stealth Chromium exposing a CDP endpoint.

Other tools connect with Playwright's `connect_over_cdp("http://127.0.0.1:PORT")`.
Run via scripts/serve.sh for background-launch ergonomics.

Usage:
    serve.py [--port 9222] [--host 127.0.0.1] [--humanize] [--proxy URL] [--geoip]
"""
import argparse
import signal
import sys
import time


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--humanize", action="store_true")
    ap.add_argument("--proxy")
    ap.add_argument("--geoip", action="store_true")
    args = ap.parse_args()

    from cloakbrowser import launch

    launch_kwargs = {
        "headless": True,
        "humanize": args.humanize,
        "args": [f"--remote-debugging-port={args.port}",
                 f"--remote-debugging-address={args.host}"],
    }
    if args.proxy:
        launch_kwargs["proxy"] = args.proxy
    if args.geoip:
        launch_kwargs["geoip"] = True

    browser = launch(**launch_kwargs)

    print(f"CDP endpoint: http://{args.host}:{args.port}", flush=True)

    def shutdown(signum, frame):
        try:
            browser.close()
        finally:
            sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        time.sleep(3600)


if __name__ == "__main__":
    sys.exit(main())
