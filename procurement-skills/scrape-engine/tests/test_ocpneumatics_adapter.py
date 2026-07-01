#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class _FakeRequest:
    def __init__(self, payload: dict):
        self.post_data_buffer = json.dumps(payload).encode("utf-8")


class _FakeResponse:
    def __init__(self, request_payload: dict, response_payload: dict):
        self.request = _FakeRequest(request_payload)
        self._response_payload = response_payload

    async def json(self) -> dict:
        return self._response_payload


class _FakeKeyboard:
    async def press(self, _key: str) -> None:
        return None


class _FakePage:
    def __init__(self):
        self.keyboard = _FakeKeyboard()

    async def wait_for_timeout(self, _ms: int) -> None:
        return None

    async def fill(self, _selector: str, _value: str) -> None:
        return None


class _FakeCtx:
    def __init__(self, responses: list[_FakeResponse]):
        self.page = _FakePage()
        self._responses = responses
        self.gotos: list[str] = []

    def on_response(self, needle: str):
        return lambda: self._responses if needle == "engine.codicloud.dev/multi-search" else []

    async def goto(self, url: str) -> None:
        self.gotos.append(url)


class OcpneumaticsAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_extract_returns_structured_rows_from_meilisearch_hits(self) -> None:
        from adapters import ocpneumatics

        request_payload = {
            "queries": [{"indexUid": "ocp_product_index", "q": "SY7120-5DZD-02"}],
        }
        response_payload = {
            "results": [{
                "indexUid": "ocp_product_index",
                "hits": [{
                    "product_sku": "SY7120-5DZD-02",
                    "product_name": "SMC solenoid valve",
                    "calculated_price": 45.75,
                    "availability": "In Stock",
                    "inventory_level": 4,
                    "url": "/products/sy7120-5dzd-02",
                }],
            }],
        }

        rows = await ocpneumatics.extract(
            _FakeCtx([_FakeResponse(request_payload, response_payload)]),
            "SY7120-5DZD-02",
        )

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row.platform, "ocpneumatics")
        self.assertEqual(row.mpn, "SY7120-5DZD-02")
        self.assertEqual(row.description, "SMC solenoid valve")
        self.assertEqual(row.stock, 4)
        self.assertIs(row.in_stock, True)
        self.assertEqual(row.price_breaks, [{"qty": 1, "rmb": None, "usd": 45.75}])
        self.assertEqual(row.product_url, "https://ocpneumatics.com/products/sy7120-5dzd-02")
        self.assertEqual(row.note, "In Stock")


if __name__ == "__main__":
    unittest.main()
