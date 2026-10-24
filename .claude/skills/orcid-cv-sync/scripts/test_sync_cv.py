from __future__ import annotations

import importlib.util
import hashlib
import html
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


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


def cv_document(peer: str = "", preprints: str = "") -> str:
    return (
        "# Fixture\n\n"
        "<!-- cv:section funding -->\n<!-- /cv:section -->\n"
        f"<!-- cv:section peer-reviewed -->\n{peer}<!-- /cv:section -->\n"
        f"<!-- cv:section preprints -->\n{preprints}<!-- /cv:section -->\n"
    )


class ImportedTextTests(unittest.TestCase):
    def test_imported_fields_render_as_text_in_astro(self) -> None:
        text = "<b>literal</b> [unexpected](javascript:bad) & entity\n<!-- /cv:section -->"
        line = sync_cv.format_entry(
            text, text, "10.1234/fixture", "2026",
            authors=[{"given": text, "family": "Author"}], self_name=(text, "Author"),
        )
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", """
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
const processor = await createMarkdownProcessor();
let source = '';
for await (const chunk of process.stdin) source += chunk;
process.stdout.write((await processor.render(source)).code);
"""],
            input=line, text=True, capture_output=True, check=True,
            cwd=SCRIPT.parents[4], timeout=15,
        )
        self.assertNotIn("<b>", result.stdout)
        self.assertNotIn("<!-- /cv:section", result.stdout)
        self.assertIn("<b>literal</b>", html.unescape(result.stdout))
        self.assertEqual(result.stdout.count("<u>"), 1)
        self.assertEqual(result.stdout.count("<a "), 1)
        self.assertIn('href="https://doi.org/10.1234/fixture"', result.stdout)

    def test_remote_text_cannot_add_sections_or_list_items(self) -> None:
        text = "A [label](https://example.test) <b>value</b>\n<!-- /cv:section -->\n1. injected"
        line = sync_cv.format_entry(
            text, text, "10.1234/fixture", "2026",
            authors=[{"given": text, "family": "Author"}],
        )
        self.assertNotIn("\n", line)
        self.assertNotIn("<!--", line)
        self.assertNotIn("<b>", line)
        document = cv_document(peer=line + "\n")
        sync_cv.validate_markers("fixture", document)
        self.assertEqual(len(sync_cv.parse_section_entries(document, "peer-reviewed")), 1)
        self.assertEqual(sync_cv.section_body(document, "preprints"), "")
        self.assertIn("10.1234/fixture", sync_cv.existing_dois(line))

    def test_funding_fields_stay_inside_one_entry(self) -> None:
        funding = sync_cv.extract_fundings(FUNDING_RESPONSE)[0]
        for field in ("title", "organization", "external_id_value"):
            funding[field] = "<b>A</b>\n<!-- cv:section preprints -->\n- extra"
        line = sync_cv.format_funding_entry(funding, "en")
        self.assertNotIn("\n", line)
        self.assertNotIn("<b>", line)
        self.assertNotIn("<!-- cv:section", line)
        self.assertEqual(line.count("<!--"), 1)

    def test_link_destination_cannot_close_its_markdown_link(self) -> None:
        url = "https://example.test/path)[label](javascript:bad)?x=1&y=2"
        escaped = sync_cv.safe_link_url(url)
        self.assertNotIn(")", escaped)
        self.assertNotIn("[", escaped)
        self.assertEqual(sync_cv.safe_link_url(escaped), escaped)
        for invalid in ("javascript:alert(1)", "https:///path", "https://user@example.test/", "https://example.test/\nextra"):
            with self.subTest(url=invalid):
                self.assertEqual(sync_cv.safe_link_url(invalid), "")

    def test_doi_and_comment_identifiers_are_validated(self) -> None:
        with self.assertRaises(ValueError):
            sync_cv.format_entry("Title", None, "10.1234/x\n<!-- extra -->", "2026")
        with self.assertRaises(ValueError):
            sync_cv.funding_marker_key(None, None, "1-->\nextra")
        funding = {"title": "Title", "key": "x-->\nextra"}
        with self.assertRaises(ValueError):
            sync_cv.format_funding_entry(funding, "en")

    def test_markdown_escaping_preserves_title_matching(self) -> None:
        title = "Protein [A] & ligand interactions in solution"
        preprint = sync_cv.format_entry(title, None, "10.1234/preprint", "2026") + "\n"
        peer = sync_cv.format_entry(title + " with extra details", None, "10.1234/journal", "2026") + "\n"
        original = cv_document(peer, preprint)
        self.assertEqual(sync_cv.prune_published_preprints(original, False), (original, []))
        peer = sync_cv.format_entry(title, None, "10.1234/journal", "2026") + "\n"
        updated, removed = sync_cv.prune_published_preprints(cv_document(peer, preprint), False)
        self.assertEqual(len(removed), 1)
        self.assertEqual(sync_cv.section_body(updated, "preprints"), "")

    def test_escaped_author_brackets_do_not_become_the_publication_title(self) -> None:
        title = "Actual publication title for matching"
        preprint = sync_cv.format_entry(
            title, None, "10.1234/preprint", "2026",
            authors=[{"given": "A [label]", "family": "Author"}],
        ) + "\n"
        peer = sync_cv.format_entry(
            title, None, "10.1234/journal", "2026",
            authors=[{"given": "B [another label]", "family": "Author"}],
        ) + "\n"
        document = cv_document(peer, preprint)
        self.assertEqual(sync_cv.parse_section_entries(document, "peer-reviewed")[0].title, title)
        updated, removed = sync_cv.prune_published_preprints(document, False)
        self.assertEqual(len(removed), 1)
        self.assertEqual(sync_cv.section_body(updated, "preprints"), "")

    def test_duplicate_nested_and_reversed_markers_are_rejected(self) -> None:
        for text in (
            "<!-- /cv:section -->\n<!-- cv:section funding -->\n",
            "<!-- cv:section funding -->\n<!-- cv:section preprints -->\n<!-- /cv:section -->\n<!-- /cv:section -->\n",
            "<!-- cv:section funding -->\n<!-- /cv:section -->\n" * 2,
        ):
            with self.subTest(text=text), self.assertRaises(SystemExit):
                sync_cv.validate_markers("fixture", text)


class ApprovedPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        (self.repo / "src/content/cv").mkdir(parents=True)
        self.original = cv_document().encode()
        self.updated = cv_document(peer="1. Approved entry.\n")
        for name in sync_cv.CV_PATHS:
            (self.repo / name).write_bytes(self.original)
        self.plan = self.repo / sync_cv.DEFAULT_PLAN
        self.digest = sync_cv.save_plan(
            self.plan, "0000-0000-0000-0001", sync_cv.read_cv_files(self.repo),
            {name: self.updated for name in sync_cv.CV_PATHS},
        )

    def test_apply_writes_exact_approved_content_without_network(self) -> None:
        argv = ["sync_cv.py", "--apply", "--expected-sha256", self.digest]
        with patch.object(sync_cv, "find_repo_root", return_value=self.repo), \
                patch("sys.argv", argv), \
                patch.object(sync_cv.urllib.request, "urlopen", side_effect=AssertionError("Unexpected network request")), \
                redirect_stderr(io.StringIO()):
            self.assertEqual(sync_cv.main(), 0)
        for name in sync_cv.CV_PATHS:
            self.assertEqual((self.repo / name).read_text(), self.updated)

    def test_tampered_plan_is_rejected_before_writing(self) -> None:
        self.plan.write_bytes(self.plan.read_bytes().replace(b"Approved", b"Changed"))
        with self.assertRaisesRegex(SystemExit, "plan changed"):
            sync_cv.apply_plan(self.repo, self.plan, self.digest)
        for name in sync_cv.CV_PATHS:
            self.assertEqual((self.repo / name).read_bytes(), self.original)

    def test_either_changed_cv_rejects_the_whole_plan(self) -> None:
        path = self.repo / sync_cv.CV_PATHS[1]
        path.write_bytes(self.original + b"\nManual edit\n")
        before = sync_cv.read_cv_files(self.repo)
        with self.assertRaisesRegex(SystemExit, "CV changed"):
            sync_cv.apply_plan(self.repo, self.plan, self.digest)
        self.assertEqual(sync_cv.read_cv_files(self.repo), before)

    def test_plan_cannot_select_another_output_path(self) -> None:
        plan = json.loads(self.plan.read_bytes())
        plan["files"]["unexpected.md"] = plan["files"].pop(sync_cv.CV_PATHS[0])
        data = json.dumps(plan).encode()
        self.plan.write_bytes(data)
        with self.assertRaisesRegex(SystemExit, "Invalid sync plan"):
            sync_cv.apply_plan(self.repo, self.plan, hashlib.sha256(data).hexdigest())
        self.assertFalse((self.repo / "unexpected.md").exists())

    def test_apply_requires_an_explicit_approved_hash(self) -> None:
        with patch.object(sync_cv, "find_repo_root", return_value=self.repo), \
                patch("sys.argv", ["sync_cv.py", "--apply"]), \
                redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            sync_cv.main()
        self.assertEqual((self.repo / sync_cv.CV_PATHS[0]).read_bytes(), self.original)

    def test_dry_run_saves_a_plan_without_changing_the_cv(self) -> None:
        argv = ["sync_cv.py", "--orcid", "0000-0000-0000-0001", "--no-crossref", "--keep-published-preprints"]
        output = io.StringIO()
        with patch.object(sync_cv, "find_repo_root", return_value=self.repo), \
                patch("sys.argv", argv), \
                patch.object(sync_cv, "fetch_orcid_works", return_value={"group": []}), \
                patch.object(sync_cv, "fetch_orcid_fundings", return_value={"group": []}), \
                redirect_stdout(io.StringIO()), redirect_stderr(output):
            self.assertEqual(sync_cv.main(), 0)
        self.assertEqual((self.repo / sync_cv.CV_PATHS[0]).read_bytes(), self.original)
        self.assertIn(hashlib.sha256(self.plan.read_bytes()).hexdigest(), output.getvalue())


if __name__ == "__main__":
    unittest.main()
