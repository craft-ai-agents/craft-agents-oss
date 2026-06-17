#!/usr/local/bin/cloakbrowser-python
"""Self-check: confirm the stealth Chromium fingerprint looks like real Chrome.

Prints a small JSON report. Exit 0 if all four core stealth tells pass:
  navigator.webdriver === false
  navigator.plugins.length > 0
  typeof window.chrome === "object"
  user-agent does NOT contain "HeadlessChrome"
Otherwise exit 1.
"""
import json
import sys


def main() -> int:
    from cloakbrowser import launch
    browser = launch(headless=True)
    try:
        page = browser.new_page()
        page.goto("about:blank")
        report = {
            "userAgent": page.evaluate("navigator.userAgent"),
            "webdriver": page.evaluate("navigator.webdriver"),
            "plugins": page.evaluate("navigator.plugins.length"),
            "windowChrome": page.evaluate("typeof window.chrome"),
        }
    finally:
        browser.close()

    checks = {
        "webdriver_false": report["webdriver"] is False,
        "plugins_present": (report["plugins"] or 0) > 0,
        "window_chrome_object": report["windowChrome"] == "object",
        "no_headless_ua": "HeadlessChrome" not in (report["userAgent"] or ""),
    }
    json.dump({"report": report, "checks": checks}, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
