#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class _FakeResponse:
    def __init__(self, payload: dict):
        self.headers = {"content-type": "application/json"}
        self._payload = payload

    async def json(self) -> dict:
        return self._payload


class _FakePage:
    def __init__(self, records: list[dict]):
        self._records = records

    async def wait_for_timeout(self, _ms: int) -> None:
        return None

    async def evaluate(self, _script: str) -> str:
        return json.dumps(self._records)


class _FakeCtx:
    def __init__(self, records: list[dict], inventory: dict, prices: dict):
        self.page = _FakePage(records)
        self._responses = {
            "ccstore/v1/inventories": [_FakeResponse(inventory)],
            "ccstore/v1/prices/skus": [_FakeResponse(prices)],
        }
        self.gotos: list[str] = []

    def on_response(self, needle: str):
        return lambda: self._responses.get(needle, [])

    async def goto(self, url: str) -> None:
        self.gotos.append(url)


class SagerAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_extract_returns_structured_rows_from_sager_xhr_payloads(self) -> None:
        from adapters import sager

        records = [{
            "attributes": {
                "product.displayName": ["PTF08A-E"],
                "product.manufacturer_name": ["Omron"],
                "sku.repositoryId": ["sku-1"],
                "product.route": ["/ptf08a-e"],
                "product.lead_time_message": ["Ships in 2 weeks"],
            },
        }]
        inventory = {
            "items": [{
                "skuNumber": "sku-1",
                "locationInventoryInfo": [
                    {"locationId": "inStock", "stockLevel": 12},
                    {"locationId": "onOrder", "stockLevel": 5},
                    {"locationId": "factoryStock", "stockLevel": 20},
                ],
            }],
        }
        prices = {
            "items": [{
                "sku-1": {
                    "listPrice": "3.50",
                    "listVolumePrice": {
                        "bulkPrice": {
                            "levels": [
                                {"levelMinimum": 1, "levelMaximum": 9, "price": "2.95"},
                                {"levelMinimum": 10, "price": "2.50"},
                            ],
                        },
                    },
                },
            }],
        }

        rows = await sager.extract(_FakeCtx(records, inventory, prices), "PTF08A-E")

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row.platform, "sager")
        self.assertEqual(row.mpn, "PTF08A-E")
        self.assertEqual(row.brand, "Omron")
        self.assertEqual(row.stock, 12)
        self.assertIs(row.in_stock, True)
        self.assertEqual(row.price_breaks, [
            {"qty": 1, "rmb": None, "usd": 2.95},
            {"qty": 10, "rmb": None, "usd": 2.5},
        ])
        self.assertEqual(row.lead_time, "Ships in 2 weeks")
        self.assertEqual(row.product_url, "https://www.sager.com/ptf08a-e")
        self.assertIn("onOrder=5", row.note or "")
        self.assertIn("factoryStock=20", row.note or "")


if __name__ == "__main__":
    unittest.main()
