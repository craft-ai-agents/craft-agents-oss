#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class _FakePage:
    def __init__(self, text: str, url: str):
        self._text = text
        self.url = url

    async def inner_text(self, _selector: str) -> str:
        return self._text

    async def wait_for_timeout(self, _ms: int) -> None:
        return None


class GenericAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_xonelec_obsolete_result_is_structured_not_body_dump(self) -> None:
        from adapters.xonelec import ADAPTER

        text = (
            'All Search Results For "PTF08A-E" Image Stock Code Description '
            'Manufacturer Global Stock Price(USD) Qty Sort By Earliest Ship Date '
            'PTF08A-E Relay Sockets & Hardware SOCKET FOR LY SP DP Omron N/A N/A Obsolete '
            "Copyright 2026 X-ON Electronics"
        )

        rows = await ADAPTER.extract(_FakePage(text, ADAPTER.url("PTF08A-E")), "PTF08A-E")

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row.mpn, "PTF08A-E")
        self.assertEqual(row.brand, "Omron")
        self.assertEqual(row.description, "Relay Sockets & Hardware SOCKET FOR LY SP DP")
        self.assertIsNone(row.stock)
        self.assertIs(row.in_stock, False)
        self.assertEqual(row.price_breaks, [])
        self.assertIn("Obsolete", row.note or "")
        self.assertNotIn("Copyright", row.note or "")

    async def test_corestaff_stock_table_result_is_structured_not_body_dump(self) -> None:
        from adapters.corestaff import ADAPTER

        text = (
            "在庫タイプ 仕入先ランク サプライヤ 在庫 ロケーション 写真 型名/メーカ名 "
            "その他情報 在庫数 デート コード 単価 最低発注数量 以降発注単位 出荷予定日 情報 "
            "B-1 取り寄せ オムロン 共用ソケット角形ソケット PTF08A-E OMRON 15 "
            "納期見積依頼 電源アクセサリ コアスタッフ型名：st65361277"
        )

        rows = await ADAPTER.extract(_FakePage(text, ADAPTER.url("PTF08A-E")), "PTF08A-E")

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row.mpn, "PTF08A-E")
        self.assertEqual(row.brand, "OMRON")
        self.assertEqual(row.description, "共用ソケット角形ソケット")
        self.assertEqual(row.stock, 15)
        self.assertIs(row.in_stock, True)
        self.assertEqual(row.lead_time, "納期見積依頼")
        self.assertEqual(row.category, "電源アクセサリ")
        self.assertIn("取り寄せ", row.note or "")

    async def test_darisus_german_no_result_is_marked_not_unknown_dump(self) -> None:
        from adapters.darisus import ADAPTER

        text = (
            "Startseite Erweiterte Suche Suchergebnisse Keine Suchergebnisse gefunden "
            "Suchbegriff: PTF08A-E"
        )

        rows = await ADAPTER.extract(_FakePage(text, ADAPTER.url("PTF08A-E")), "PTF08A-E")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].availability_status, "no_result")
        self.assertEqual(rows[0].note, "（无匹配）")


if __name__ == "__main__":
    unittest.main()
