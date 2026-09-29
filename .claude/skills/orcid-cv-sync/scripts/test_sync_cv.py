from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("sync_cv.py")
SPEC = importlib.util.spec_from_file_location("sync_cv", SCRIPT)
assert SPEC and SPEC.loader
sync_cv = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync_cv)


FUNDING_RESPONSE = {
    "group": [
        {
            "external-ids": {
                "external-id": [
                    {
                        "external-id-type": "grant_number",
                        "external-id-value": " JPMJBS2430 ",
                    },
                ],
            },
            "funding-summary": [
                {
                    "put-code": 2480055,
                    "title": {
                        "title": {"value": "JST Science Tokyo BOOST"},
                        "translated-title": None,
                    },
                    "url": {"value": "https://www.tmd.ac.jp/campuslife/boost/"},
                    "start-date": {
                        "year": {"value": "2025"},
                        "month": {"value": "04"},
                        "day": None,
                    },
                    "end-date": {
                        "year": {"value": "2028"},
                        "month": {"value": "03"},
                        "day": None,
                    },
                    "external-ids": {
                        "external-id": [
                            {
                                "external-id-type": "grant_number",
                                "external-id-value": " JPMJBS2430 ",
                            },
                        ],
                    },
                    "organization": {"name": "JST"},
                },
            ],
        },
    ],
}


class OrcidLinkTests(unittest.TestCase):
    def test_body_links_ignore_heading_and_label_text(self) -> None:
        orcid_id = "0000-0000-0000-0001"
        ja = f"### リンク\n- orcid: https://orcid.org/{orcid_id}\n"
        for en in (
            f"### Links\n- [ORCID](https://orcid.org/{orcid_id})\n",
            f"## Profiles\n- <https://orcid.org/{orcid_id}>\n",
            f"- Research profile: https://orcid.org/{orcid_id}/\n",
        ):
            with self.subTest(en=en):
                self.assertEqual(sync_cv.read_orcid_id(ja, en), orcid_id)

    def test_either_locale_can_supply_the_link(self) -> None:
        text = "- orcid: https://orcid.org/0000-0000-0000-0001\n"
        for ja, en in ((text, ""), ("", text)):
            with self.subTest(ja=ja, en=en):
                self.assertEqual(sync_cv.read_orcid_id(ja, en), "0000-0000-0000-0001")

    def test_repeated_link_and_checksum_case_are_normalized(self) -> None:
        text = "- [ORCID](https://orcid.org/0000-0000-0000-000x)\n"
        self.assertEqual(
            sync_cv.read_orcid_id(text * 2, text.upper()),
            "0000-0000-0000-000X",
        )

    def test_mismatched_locales_are_rejected(self) -> None:
        with self.assertRaisesRegex(SystemExit, "ORCID iD mismatch"):
            sync_cv.read_orcid_id(
                "https://orcid.org/0000-0000-0000-0001",
                "https://orcid.org/0000-0000-0000-0002",
            )

    def test_ambiguous_profile_links_are_rejected(self) -> None:
        with self.assertRaisesRegex(SystemExit, "Multiple ORCID iDs in ja.md"):
            sync_cv.read_orcid_id(
                "- https://orcid.org/0000-0000-0000-0001\n"
                "- https://orcid.org/0000-0000-0000-0002\n",
                "",
            )

    def test_missing_or_malformed_links_do_not_select_a_record(self) -> None:
        for text in (
            "## Education\n",
            "---\norcid: 0000-0000-0000-0001\n---\n",
            "https://notorcid.org/0000-0000-0000-0001",
            "https://orcid.org.example.com/0000-0000-0000-0001",
            "https://orcid.org/0000-0000-0000-00012",
            "https://orcid.org/0000-0000-0000-000Y",
        ):
            with self.subTest(text=text):
                with self.assertRaisesRegex(SystemExit, "ORCID iD not found"):
                    sync_cv.read_orcid_id(text, "")


class FundingSyncTests(unittest.TestCase):
    def test_extract_and_format_bilingual_funding(self) -> None:
        funding = sync_cv.extract_fundings(FUNDING_RESPONSE)[0]

        self.assertEqual(funding["key"], "grant-number:jpmjbs2430")
        self.assertEqual(funding["external_id_value"], "JPMJBS2430")
        self.assertEqual(
            sync_cv.format_funding_entry(funding, "ja"),
            "- [JST Science Tokyo BOOST](https://www.tmd.ac.jp/campuslife/boost/), "
            "JST, 課題番号: JPMJBS2430, 2025/4–2028/3. "
            "<!-- orcid-funding:grant-number:jpmjbs2430 -->",
        )
        self.assertEqual(
            sync_cv.format_funding_entry(funding, "en"),
            "- [JST Science Tokyo BOOST](https://www.tmd.ac.jp/campuslife/boost/), "
            "JST, Grant No. JPMJBS2430, April 2025–March 2028. "
            "<!-- orcid-funding:grant-number:jpmjbs2430 -->",
        )

    def test_existing_marker_or_visible_grant_number_is_idempotent(self) -> None:
        funding = sync_cv.extract_fundings(FUNDING_RESPONSE)
        marked = (
            "<!-- cv:section funding -->\n"
            "- Existing. <!-- orcid-funding:grant-number:jpmjbs2430 -->\n"
            "<!-- /cv:section -->\n"
        )
        manual = (
            "<!-- cv:section funding -->\n"
            "- Existing grant, JPMJBS2430.\n"
            "<!-- /cv:section -->\n"
        )

        self.assertEqual(sync_cv.build_funding_entries_for(funding, marked, "en"), ([], 0))
        self.assertEqual(sync_cv.build_funding_entries_for(funding, manual, "en"), ([], 0))

    def test_put_code_fallback_and_partial_date(self) -> None:
        response = {
            "group": [
                {
                    "funding-summary": [
                        {
                            "put-code": 99,
                            "title": {
                                "title": {"value": "Primary title"},
                                "translated-title": {
                                    "value": "日本語題名",
                                    "language-code": "ja",
                                },
                            },
                            "start-date": {"year": {"value": "2024"}},
                        },
                    ],
                },
            ],
        }
        funding = sync_cv.extract_fundings(response)[0]

        self.assertEqual(funding["key"], "put-code:99")
        self.assertEqual(sync_cv.funding_title(funding, "ja"), "日本語題名")
        self.assertEqual(
            sync_cv.format_funding_entry(funding, "en"),
            "- Primary title, 2024. <!-- orcid-funding:put-code:99 -->",
        )


if __name__ == "__main__":
    unittest.main()
