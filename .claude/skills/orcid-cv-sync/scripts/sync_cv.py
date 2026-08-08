#!/usr/bin/env python3
"""Sync new publications and funding from ORCID into the bilingual CV.

Everything this script needs lives in the CV markdown itself — it never
reads ``profile.yaml``. ``src/content/cv/{ja,en}.md`` declare their ORCID
iD as an ``orcid:`` frontmatter key and mark managed lists with
``<!-- cv:section <kind> -->`` … ``<!-- /cv:section -->``.
Heading text is therefore free-form: renaming or translating a section
heading cannot break this script (the previous version matched headings
by regex and did break).

Works are fetched from ``pub.orcid.org`` (no authentication required);
any DOI not already present in ``ja.md`` / ``en.md`` is inserted directly
after the matching section's start marker, in reverse chronological order.
Funding summaries are fetched from the same API and inserted into the
``funding`` section when their normalized external ID is not already present.
The ORCID put-code is the fallback identity when a record has no external ID.

For each new work, also queries the CrossRef API by DOI to fetch the author
list (ORCID itself does not return authors). Each author is rendered as a
bold name; the record holder's own name (resolved from ORCID's ``/person``
endpoint) is wrapped in ``<u>...</u>`` to match the existing CV style.
CrossRef lookup failures fall back to a ``[authors — TODO]`` placeholder
so a network blip never breaks the script.

Additive for new works and funding, with exactly one deletion rule: a preprint
entry is removed once its peer-reviewed version is listed in the CV's
``peer-reviewed`` section. Nothing else is ever modified or removed. Because
the prune runs on the post-insertion content, it also covers the case where
ORCID hands us the preprint and the journal article in the same batch — the
preprint is inserted and immediately pruned, so it never reaches the diff.

The script emits a unified diff in dry-run mode (default); pass ``--apply``
to write.

Usage:
    uv run scripts/sync_cv.py            # dry-run
    uv run scripts/sync_cv.py --apply    # write changes
    uv run scripts/sync_cv.py --orcid 0000-0000-0000-0000   # override ORCID iD
    uv run scripts/sync_cv.py --no-crossref   # skip CrossRef, use [authors — TODO]
    uv run scripts/sync_cv.py --keep-published-preprints    # disable the prune

Zero third-party dependencies — Python 3.9+ stdlib only.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import NamedTuple

# Preprint-server DOI prefixes. Used as a fallback when ORCID's `type`
# field doesn't say "preprint" (which it sometimes doesn't, even for
# bioRxiv submissions).
PREPRINT_PREFIXES = {
    "10.1101",   # bioRxiv / medRxiv
    "10.48550",  # arXiv
    "10.31219",  # OSF preprints
    "10.20944",  # Preprints.org
    "10.64898",  # ChemRxiv (modern prefix)
}

DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+", re.IGNORECASE)
NORMALIZE_RE = re.compile(r"[^a-z0-9]")
FUNDING_MARKER_RE = re.compile(
    r"<!--\s*orcid-funding:([a-z0-9][a-z0-9._:-]*)\s*-->",
    re.IGNORECASE,
)
FUNDING_KEY_TOKEN_RE = re.compile(r"[^a-z0-9]+")

MONTH_NAMES = (
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)

# Shortest normalized title we'll trust for fuzzy matching. Below this the
# false-positive risk dominates — a title like "Introduction" would match
# almost anything.
MIN_TITLE_MATCH_LEN = 20

# CV frontmatter. Scalars only (`key: value`), which is all the CV declares,
# so a real YAML parser isn't worth a third-party dependency here. The
# schema in src/content.config.ts validates the same fields at build time.
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
FM_ORCID_RE = re.compile(
    r"^orcid:\s*(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# CrossRef asks callers to identify themselves; a contact address would move
# requests onto its faster "polite pool", but that is a convention rather
# than a requirement and the CV deliberately carries no email, so send a
# plain tool identifier. See https://api.crossref.org/swagger-ui/index.html
CROSSREF_UA = "orcid-cv-sync/1.0"

# Section markers. `kind` is locale-independent so ja.md and en.md use the
# exact same strings — see src/plugins/remark-cv-sections.mjs, which turns
# these into `data-cv-section` attributes for the CV page at build time.
# The marker must own its whole line, exactly as the remark plugin requires:
# accepting a looser form here would let the script insert into a "section"
# the plugin refuses to recognise, silently dropping the BibTeX buttons.
SECTION_START_TMPL = r"^[ \t]*<!--\s*cv:section\s+{kind}\s*-->[ \t]*$"
ANY_SECTION_START_RE = re.compile(
    SECTION_START_TMPL.format(kind=r"[a-z][a-z0-9-]*"),
    re.MULTILINE,
)
SECTION_END_RE = re.compile(r"^[ \t]*<!--\s*/cv:section\s*-->[ \t]*$", re.MULTILINE)

# One CV entry starts at a list marker in the outermost column. CommonMark
# lets a top-level item carry up to 3 leading spaces, but a *continuation*
# line must be indented to its parent's content column — 3 spaces for the
# `1. ` marker this CV uses. Allowing 0-2 spaces therefore matches every
# sibling entry while leaving nested footnotes (`   - \*Co-first authors`)
# attached to the entry above them. Matching `[ \t]*` instead would treat
# those footnotes as entries of their own and orphan them on removal.
ITEM_START_RE = re.compile(r"^ {0,2}(?:\d+[.)]|[-*+])\s")
# The paper title is the only Markdown link in an entry — `[authors — TODO]`
# has no `(` after it, so requiring `](` skips the placeholder.
LINK_TITLE_RE = re.compile(r"\[([^\]]+)\]\(")


def normalize(s: str) -> str:
    """Strip everything but a-z 0-9 and lowercase. Used for fuzzy title
    matching against the existing CV body — diacritics, punctuation, and
    whitespace would otherwise prevent obvious duplicates from matching."""
    return NORMALIZE_RE.sub("", s.lower())


def title_already_present(title: str | None, *texts: str) -> bool:
    """Return True if the normalized title is a substring of any of `texts`.

    Used for the POSSIBLE DUPLICATE warning, where `texts` is deliberately
    both whole file bodies. Do NOT reuse this call shape for the preprint
    prune — see `prune_published_preprints`.
    """
    if not title:
        return False
    norm_t = normalize(title)
    if len(norm_t) < MIN_TITLE_MATCH_LEN:
        return False
    for text in texts:
        if norm_t in normalize(text):
            return True
    return False


def find_repo_root() -> Path:
    """Walk up from cwd until we find ``src/content/cv/ja.md``."""
    p = Path.cwd().resolve()
    while True:
        if (p / "src" / "content" / "cv" / "ja.md").exists():
            return p
        if p == p.parent:
            raise SystemExit(
                "Could not find repo root — run this from the project tree.",
            )
        p = p.parent


def frontmatter(text: str) -> str:
    """Return the raw frontmatter block, or '' when the file has none."""
    m = FRONTMATTER_RE.match(text)
    return m.group(1) if m else ""


def read_orcid_id(ja_text: str, en_text: str) -> str:
    """Read the `orcid:` frontmatter key from the CV markdown.

    Both locales declare it so either file stands on its own; a mismatch is
    a hard error rather than a silent pick, since syncing the wrong record
    into one locale is worse than refusing to run.
    """
    ja = FM_ORCID_RE.search(frontmatter(ja_text))
    en = FM_ORCID_RE.search(frontmatter(en_text))
    if ja and en and ja.group(1).upper() != en.group(1).upper():
        raise SystemExit(
            f"ORCID iD mismatch: ja.md declares {ja.group(1)} but en.md "
            f"declares {en.group(1)}. Fix one of them before syncing.",
        )
    found = ja or en
    if not found:
        raise SystemExit(
            "ORCID iD not found — add `orcid: 0000-0000-0000-0000` to the "
            "frontmatter of src/content/cv/ja.md (or pass --orcid).",
        )
    return found.group(1)


def fetch_orcid_section(orcid_id: str, section: str) -> dict:
    """Fetch one public ORCID record section as JSON."""
    url = f"https://pub.orcid.org/v3.0/{orcid_id}/{section}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.URLError as e:
        raise SystemExit(f"ORCID API request failed for /{section}: {e}") from e


def fetch_orcid_works(orcid_id: str) -> dict:
    return fetch_orcid_section(orcid_id, "works")


def fetch_orcid_fundings(orcid_id: str) -> dict:
    return fetch_orcid_section(orcid_id, "fundings")


def fetch_orcid_self_name(orcid_id: str) -> tuple[str, str] | None:
    """Return ``(given, family)`` of the ORCID record holder for self-marking.

    Used to wrap the user's own name in ``<u>...</u>`` when rendering the
    author list. Returns ``None`` if ORCID's ``/person`` endpoint is
    unreachable or the record has no public name.
    """
    url = f"https://pub.orcid.org/v3.0/{orcid_id}/person"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except urllib.error.URLError as e:
        print(
            f"[orcid-cv-sync] WARN: ORCID /person fetch failed: {e}; "
            f"author self-marking disabled.",
            file=sys.stderr,
        )
        return None
    name = data.get("name") or {}
    given = ((name.get("given-names") or {}).get("value") or "").strip()
    family = ((name.get("family-name") or {}).get("value") or "").strip()
    if family:
        return (given, family)
    return None


# One CrossRef record per DOI serves both the author list and the
# preprint→journal relation, so cache the whole `message` rather than
# fetching the same URL twice for the two consumers.
_crossref_cache: dict[str, dict | None] = {}
_crossref_failures = 0


def fetch_crossref_work(doi: str) -> dict | None:
    """Return CrossRef's ``message`` object for ``doi``, or ``None`` on failure.

    A failure here is non-fatal — author lookups fall back to the
    ``[authors — TODO]`` placeholder, and the preprint prune falls back to
    title matching.
    """
    global _crossref_failures
    if doi in _crossref_cache:
        return _crossref_cache[doi]
    url = f"https://api.crossref.org/works/{urllib.request.quote(doi, safe='/')}"
    req = urllib.request.Request(url, headers={"User-Agent": CROSSREF_UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.load(resp)
    except urllib.error.URLError as e:
        print(
            f"[orcid-cv-sync] WARN: CrossRef lookup failed for {doi}: {e}",
            file=sys.stderr,
        )
        _crossref_failures += 1
        _crossref_cache[doi] = None
        return None
    message = data.get("message") or None
    _crossref_cache[doi] = message
    return message


def crossref_authors(doi: str) -> list[dict] | None:
    """Return ``[{given, family}, ...]`` from CrossRef, or ``None`` on failure."""
    message = fetch_crossref_work(doi)
    if not message:
        return None
    out: list[dict] = []
    for a in message.get("author") or []:
        given = (a.get("given") or "").strip()
        family = (a.get("family") or "").strip()
        if family:
            out.append({"given": given, "family": family})
    return out or None


def crossref_published_dois(doi: str) -> set[str]:
    """DOIs of the peer-reviewed article(s) this preprint turned into.

    CrossRef records the link on the **preprint** side only
    (``relation["is-preprint-of"]``); the journal article's own record
    carries an empty ``relation``. So this is only ever worth calling with
    a preprint DOI.
    """
    message = fetch_crossref_work(doi)
    if not message:
        return set()
    out: set[str] = set()
    for rel in (message.get("relation") or {}).get("is-preprint-of", []):
        if rel.get("id-type") == "doi" and rel.get("id"):
            out.add(rel["id"].strip().lower())
    return out


def existing_dois(text: str) -> set[str]:
    """Pull every DOI-shaped substring out of `text`. Tolerant: trailing
    punctuation that's not part of a DOI is stripped."""
    out: set[str] = set()
    for m in DOI_RE.finditer(text):
        doi = m.group(0)
        # Strip trailing punctuation that the regex's char class greedily ate.
        doi = doi.rstrip(".,;:)")
        out.add(doi.lower())
    return out


def classify(work_type: str, doi: str) -> str:
    """Return ``'preprint'`` or ``'journal'`` for placement decisions."""
    prefix = doi.split("/", 1)[0] if "/" in doi else ""
    if work_type == "preprint" or prefix in PREPRINT_PREFIXES:
        return "preprint"
    return "journal"


def render_authors(
    authors: list[dict] | None,
    self_name: tuple[str, str] | None,
) -> str:
    """Render the author list as a comma-separated string of bold names,
    with the record holder wrapped in ``<u>...</u>``. Returns the
    ``[authors — TODO]`` placeholder when CrossRef gave us nothing."""
    if not authors:
        return "[authors — TODO]"
    self_family = self_name[1] if self_name else None
    self_given = self_name[0] if self_name else None
    rendered: list[str] = []
    for a in authors:
        given = a["given"]
        family = a["family"]
        full = f"{given} {family}".strip() if given else family
        # Match self by family-name equality plus a soft check on the given
        # name's first token (handles middle names, initials).
        is_self = False
        if self_family and family == self_family:
            if not self_given:
                is_self = True
            elif given:
                first_tok = given.split()[0] if given.split() else ""
                if first_tok and self_given.split():
                    is_self = first_tok.lower() == self_given.split()[0].lower()
        rendered.append(f"**<u>{full}</u>**" if is_self else f"**{full}**")
    return ", ".join(rendered)


def format_entry(
    title: str,
    journal: str | None,
    doi: str,
    year: str,
    authors: list[dict] | None = None,
    self_name: tuple[str, str] | None = None,
    possible_duplicate: bool = False,
) -> str:
    """Render one numbered list item.

    Uses the `1.` marker for every entry; CommonMark auto-numbers them
    sequentially, matching the style of the conference-presentations
    sections. Keeping every line as `1.` means inserting/removing entries
    never requires renumbering downstream items.

    IMPORTANT — DO NOT put HTML comments (`<!-- ... -->`) at the start of a
    list item. Astro/remark treats them as a "raw HTML block" trigger and
    silently disables ALL Markdown formatting on the line — Markdown links,
    `*emphasis*`, and `**bold**` all leak through as literal characters.
    The author placeholder is therefore plain text `[authors — TODO]`
    (when CrossRef lookup fails), and only the optional duplicate-warning
    comment is appended at the line END (where inline HTML is safe).

    Output shape (matching the existing manual CV style):

        1. **Given Family**, **<u>Self Family</u>**, ..., [Title](https://doi.org/...),
           *Journal*, DOI:..., (year).
    """
    author_part = render_authors(authors, self_name)
    journal_part = f", *{journal}*" if journal else ""
    when_part = f", ({year})" if year else ""
    body = (
        f"1. {author_part}, [{title}](https://doi.org/{doi})"
        f"{journal_part}, DOI:{doi}{when_part}."
    )
    if possible_duplicate:
        body += (
            " <!-- POSSIBLE DUPLICATE: title matches an existing CV entry; "
            "review and remove if it's really the same paper -->"
        )
    return body


def extract_works(orcid_data: dict) -> list[dict]:
    """Flatten ORCID's ``group[].work-summary[]`` into one entry per DOI.

    Each ORCID group represents a single conceptual work that may have been
    deposited from multiple sources (CrossRef, DataCite, the user). We pick
    the first work-summary, since the relevant fields are stable across
    duplicates.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for group in orcid_data.get("group", []):
        summaries = group.get("work-summary", [])
        if not summaries:
            continue
        ws = summaries[0]
        doi = None
        for ext in (ws.get("external-ids") or {}).get("external-id", []):
            if ext.get("external-id-type") == "doi":
                value = ext.get("external-id-value", "")
                if value:
                    doi = value.lower()
                    break
        if not doi or doi in seen:
            continue
        seen.add(doi)
        title_obj = ws.get("title") or {}
        title = (title_obj.get("title") or {}).get("value")
        journal = (ws.get("journal-title") or {}).get("value")
        pubdate = ws.get("publication-date") or {}
        year = (pubdate.get("year") or {}).get("value", "")
        month = (pubdate.get("month") or {}).get("value")
        day = (pubdate.get("day") or {}).get("value")
        work_type = ws.get("type", "") or ""
        out.append(
            {
                "doi": doi,
                "title": title,
                "journal": journal,
                "year": year,
                "month": month,
                "day": day,
                "type": work_type,
            },
        )
    out.sort(
        key=lambda work: tuple(
            int(work.get(part) or 0) for part in ("year", "month", "day")
        ),
        reverse=True,
    )
    return out


def normalize_external_id_type(value: str) -> str:
    """Normalize ORCID external-ID type spelling for comparisons."""
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def funding_marker_key(
    external_id_type: str | None,
    external_id_value: str | None,
    put_code: int | str | None,
) -> str:
    """Build a stable, HTML-comment-safe identity for one funding record."""
    if external_id_type and external_id_value:
        kind = FUNDING_KEY_TOKEN_RE.sub("-", external_id_type.lower()).strip("-")
        value = FUNDING_KEY_TOKEN_RE.sub("-", external_id_value.lower()).strip("-")
        if kind and value:
            return f"{kind}:{value}"
    return f"put-code:{put_code}"


def extract_fundings(orcid_data: dict) -> list[dict]:
    """Flatten ORCID funding groups into one record per stable identity."""
    out: list[dict] = []
    seen: set[str] = set()
    for group in orcid_data.get("group", []):
        summaries = group.get("funding-summary", [])
        if not summaries:
            continue
        summary = summaries[0]
        title_obj = summary.get("title") or {}
        primary_title = ((title_obj.get("title") or {}).get("value") or "").strip()
        translated = title_obj.get("translated-title") or {}

        external_ids = (summary.get("external-ids") or {}).get("external-id", [])
        if not external_ids:
            external_ids = (group.get("external-ids") or {}).get("external-id", [])
        cleaned_ids: list[tuple[str, str]] = []
        for external_id in external_ids:
            kind = normalize_external_id_type(
                str(external_id.get("external-id-type") or ""),
            )
            value = str(external_id.get("external-id-value") or "").strip()
            if kind and value:
                cleaned_ids.append((kind, value))
        preferred_id = next(
            (item for item in cleaned_ids if item[0] == "grant_number"),
            cleaned_ids[0] if cleaned_ids else None,
        )
        put_code = summary.get("put-code")
        key = funding_marker_key(
            preferred_id[0] if preferred_id else None,
            preferred_id[1] if preferred_id else None,
            put_code,
        )
        if key in seen:
            continue
        seen.add(key)

        organization = summary.get("organization") or {}
        url = ((summary.get("url") or {}).get("value") or "").strip()
        if not re.match(r"^https?://", url, re.IGNORECASE):
            url = ""
        out.append(
            {
                "key": key,
                "title": primary_title,
                "translated_title": (translated.get("value") or "").strip(),
                "translated_language": (
                    translated.get("language-code") or ""
                ).strip().lower(),
                "organization": (organization.get("name") or "").strip(),
                "url": url,
                "start_date": summary.get("start-date") or {},
                "end_date": summary.get("end-date") or {},
                "external_id_type": preferred_id[0] if preferred_id else "",
                "external_id_value": preferred_id[1] if preferred_id else "",
            },
        )

    def sort_key(funding: dict) -> tuple[int, int, int]:
        date = funding["start_date"]

        def part(name: str) -> int:
            raw = (date.get(name) or {}).get("value")
            try:
                return int(raw or 0)
            except (TypeError, ValueError):
                return 0

        return (part("year"), part("month"), part("day"))

    out.sort(key=sort_key, reverse=True)
    return out


def funding_title(funding: dict, lang: str) -> str:
    """Pick a locale-matching translated title when ORCID provides one."""
    translated_language = funding.get("translated_language", "")
    if translated_language == lang or translated_language.startswith(f"{lang}-"):
        translated = funding.get("translated_title", "")
        if translated:
            return translated
    primary = funding.get("title", "")
    if primary:
        return primary
    return "（名称未登録）" if lang == "ja" else "(untitled funding)"


def format_orcid_date(date: dict, lang: str) -> str:
    """Format an ORCID partial date without inventing missing precision."""
    year = str((date.get("year") or {}).get("value") or "").strip()
    month_raw = str((date.get("month") or {}).get("value") or "").strip()
    day_raw = str((date.get("day") or {}).get("value") or "").strip()
    if not year:
        return ""
    try:
        month = int(month_raw) if month_raw else 0
    except ValueError:
        month = 0
    try:
        day = int(day_raw) if day_raw else 0
    except ValueError:
        day = 0
    if not 1 <= month <= 12:
        return year
    if lang == "ja":
        return f"{year}/{month}/{day}" if day > 0 else f"{year}/{month}"
    month_name = MONTH_NAMES[month]
    return f"{month_name} {day}, {year}" if day > 0 else f"{month_name} {year}"


def format_funding_entry(
    funding: dict,
    lang: str,
    possible_duplicate: bool = False,
) -> str:
    """Render one funding summary as an unordered Markdown list item."""
    title = funding_title(funding, lang)
    url = funding.get("url", "")
    parts = [f"[{title}]({url})" if url else title]
    if funding.get("organization"):
        parts.append(funding["organization"])
    external_id = funding.get("external_id_value", "")
    if external_id:
        if funding.get("external_id_type") == "grant_number":
            label = "課題番号" if lang == "ja" else "Grant No."
            separator = ": " if lang == "ja" else " "
            parts.append(f"{label}{separator}{external_id}")
        else:
            parts.append(external_id)
    start = format_orcid_date(funding.get("start_date", {}), lang)
    end = format_orcid_date(funding.get("end_date", {}), lang)
    if start and end:
        parts.append(f"{start}–{end}")
    elif start or end:
        parts.append(start or end)
    body = f"- {', '.join(parts)}."
    if possible_duplicate:
        body += " <!-- POSSIBLE DUPLICATE: funding title matches this CV -->"
    return f"{body} <!-- orcid-funding:{funding['key']} -->"


def validate_markers(label: str, content: str) -> None:
    """Fail loudly on unbalanced ``cv:section`` markers.

    A missing ``<!-- /cv:section -->`` doesn't raise anywhere else — the
    remark plugin would just keep stamping the following lists with the
    previous section's kind — so catch it here, where a human is watching.
    """
    starts = len(ANY_SECTION_START_RE.findall(content))
    ends = len(SECTION_END_RE.findall(content))
    if starts != ends:
        raise SystemExit(
            f"{label}: unbalanced section markers "
            f"({starts} `cv:section`, {ends} `/cv:section`).",
        )


def section_span(content: str, kind: str) -> tuple[int, int] | None:
    """Line-index range ``[start, end)`` of the body wrapped by section ``kind``.

    ``start`` is the line right after ``<!-- cv:section <kind> -->`` and
    ``end`` is the index of the matching ``<!-- /cv:section -->`` line, so
    the slice holds the list and nothing else.

    Returns ``None`` when the section marker is absent (or, defensively,
    when its closing partner is — ``validate_markers`` aborts the run on
    unbalanced markers long before we get here).
    """
    start_re = re.compile(SECTION_START_TMPL.format(kind=re.escape(kind)))
    lines = content.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if start_re.search(line):
            for j in range(i + 1, len(lines)):
                if SECTION_END_RE.search(lines[j]):
                    return (i + 1, j)
            return None
    return None


def section_body(content: str, kind: str) -> str:
    """Text between the ``kind`` markers, or ``''`` when the section is absent."""
    span = section_span(content, kind)
    if span is None:
        return ""
    lines = content.splitlines(keepends=True)
    return "".join(lines[span[0]:span[1]])


def existing_funding_keys(content: str) -> set[str]:
    """Read script-owned funding identities from the funding section."""
    body = section_body(content, "funding")
    return {match.group(1).lower() for match in FUNDING_MARKER_RE.finditer(body)}


def build_funding_entries_for(
    fundings: list[dict],
    content: str,
    lang: str,
) -> tuple[list[str], int]:
    """Build missing funding lines for one locale without rewriting entries."""
    body = section_body(content, "funding")
    body_lower = body.lower()
    known = existing_funding_keys(content)
    entries: list[str] = []
    duplicate_warnings = 0
    for funding in fundings:
        key = funding["key"].lower()
        external_id = funding.get("external_id_value", "").strip().lower()
        if key in known or (external_id and external_id in body_lower):
            continue
        title = funding_title(funding, lang)
        possible_duplicate = title_already_present(title, body)
        if possible_duplicate:
            duplicate_warnings += 1
        entries.append(
            format_funding_entry(
                funding,
                lang,
                possible_duplicate=possible_duplicate,
            ),
        )
    return entries, duplicate_warnings


class Entry(NamedTuple):
    """One list item inside a ``cv:section`` block."""

    start: int          # first line index, inclusive
    end: int            # one past the last line, trailing blanks trimmed
    text: str
    dois: set[str]
    title: str | None


def parse_section_entries(content: str, kind: str) -> list[Entry]:
    """Split section ``kind`` into its list items.

    An item runs from its list marker to just before the next one, minus any
    trailing blank lines, so an indented footnote (``   - \\*Co-first
    authors``) travels with the entry it annotates instead of being mistaken
    for one — see ``ITEM_START_RE``.
    """
    span = section_span(content, kind)
    if span is None:
        return []
    start, end = span
    lines = content.splitlines(keepends=True)
    starts = [i for i in range(start, end) if ITEM_START_RE.match(lines[i])]
    entries: list[Entry] = []
    for n, first in enumerate(starts):
        last = starts[n + 1] if n + 1 < len(starts) else end
        while last > first + 1 and not lines[last - 1].strip():
            last -= 1
        text = "".join(lines[first:last])
        m = LINK_TITLE_RE.search(text)
        entries.append(
            Entry(first, last, text, existing_dois(text), m.group(1) if m else None),
        )
    return entries


def section_insert_index(content: str, kind: str) -> int | None:
    """Line index where a new entry belongs for section ``kind``.

    That's the first non-blank line after the ``<!-- cv:section <kind> -->``
    marker — i.e. the top of the list, or the closing marker when the
    section is still empty. Blank lines are skipped so a locale that puts
    one after the marker (en.md does, ja.md doesn't) keeps its list tight;
    a blank line between items would turn the whole list loose and change
    its spacing.

    Returns ``None`` when the section marker is absent.
    """
    span = section_span(content, kind)
    if span is None:
        return None
    start, end = span
    lines = content.splitlines(keepends=True)
    j = start
    while j < end and not lines[j].strip():
        j += 1
    return j


def insert_into_section(
    label: str,
    content: str,
    kind: str,
    entries: list[str],
) -> str:
    """Insert `entries` at the top of the ``kind`` section.

    Unlike earlier versions, a missing marker is a hard error rather than a
    cue to invent a heading — guessing where a publication belongs would
    violate the additive-only contract.
    """
    if not entries:
        return content
    insert_at = section_insert_index(content, kind)
    if insert_at is None:
        raise SystemExit(
            f"{label}: `<!-- cv:section {kind} -->` marker not found, so "
            f"there is nowhere to add {len(entries)} entry/entries. Add the "
            f"marker (and its `<!-- /cv:section -->`) around that list.",
        )
    lines = content.splitlines(keepends=True)
    block = "\n".join(entries) + "\n"
    return "".join(lines[:insert_at]) + block + "".join(lines[insert_at:])


def drop_entries(content: str, kind: str, doomed: list[Entry]) -> str:
    """Remove ``doomed`` items from section ``kind``, blank lines included.

    Each removal also swallows the blank line that separated the item from
    its neighbour. Leaving it behind would put two blanks in a row, which
    CommonMark reads as the end of the list — every surviving entry would
    then restart at "1.".
    """
    span = section_span(content, kind)
    if span is None or not doomed:
        return content
    sec_start, sec_end = span
    lines = content.splitlines(keepends=True)
    first_start = min(e.start for e in parse_section_entries(content, kind))
    drop: set[int] = set()
    for entry in doomed:
        drop.update(range(entry.start, entry.end))
        if entry.start > first_start:
            if entry.start - 1 >= sec_start and not lines[entry.start - 1].strip():
                drop.add(entry.start - 1)
        elif entry.end < sec_end and not lines[entry.end].strip():
            drop.add(entry.end)
    return "".join(line for i, line in enumerate(lines) if i not in drop)


def prune_published_preprints(
    content: str,
    use_crossref: bool = True,
) -> tuple[str, list[tuple[Entry, str | None, str | None, str]]]:
    """Drop preprint entries whose peer-reviewed version is already listed.

    Returns the new content plus ``(entry, preprint_doi, published_doi, via)``
    per removal.

    Two signals, in order of trust:

    1. CrossRef ``relation["is-preprint-of"]`` on the preprint's own DOI. The
       link is asserted on the preprint side only — the journal article's
       record carries an empty ``relation`` — so we always query the preprint.
    2. Normalized title equality, for servers that assert no relation.

    Matching is scoped to THIS file's ``peer-reviewed`` section. Comparing a
    preprint's title against the whole file (the way the POSSIBLE DUPLICATE
    warning does) would match the preprint's own line and wipe the section.
    """
    entries = parse_section_entries(content, "preprints")
    if not entries:
        return content, []
    journal_body = section_body(content, "peer-reviewed")
    journal_dois = existing_dois(journal_body)
    journal_norm = normalize(journal_body)
    if not journal_dois and not journal_norm:
        return content, []

    removals: list[tuple[Entry, str | None, str | None, str]] = []
    for entry in entries:
        # Skip DOIs already listed as peer-reviewed: those are the hand-written
        # "published as …" annotation, and journal records carry no relation.
        own_dois = sorted(entry.dois - journal_dois)
        source: str | None = own_dois[0] if own_dois else None
        published: str | None = None
        via: str | None = None
        if use_crossref:
            for doi in own_dois:
                hit = crossref_published_dois(doi) & journal_dois
                if hit:
                    source, published, via = doi, sorted(hit)[0], "is-preprint-of"
                    break
        if via is None and entry.title:
            norm_title = normalize(entry.title)
            if len(norm_title) >= MIN_TITLE_MATCH_LEN and norm_title in journal_norm:
                via = "title match"
        if via:
            removals.append((entry, source, published, via))
    if not removals:
        return content, []
    return drop_entries(content, "preprints", [r[0] for r in removals]), removals


def show_diff(label: str, old: str, new: str) -> bool:
    if old == new:
        return False
    diff = difflib.unified_diff(
        old.splitlines(keepends=True),
        new.splitlines(keepends=True),
        fromfile=f"a/{label}",
        tofile=f"b/{label}",
    )
    sys.stdout.writelines(diff)
    return True


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Sync new ORCID publications and funding into the CV",
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default: dry-run, prints diff only)",
    )
    ap.add_argument(
        "--orcid",
        help="Override ORCID iD (otherwise read from the CV's `orcid:` frontmatter)",
    )
    ap.add_argument(
        "--no-crossref",
        action="store_true",
        help="Skip CrossRef author lookup; emit [authors — TODO] placeholder",
    )
    ap.add_argument(
        "--keep-published-preprints",
        action="store_true",
        help="Keep preprint entries whose peer-reviewed version is already listed",
    )
    args = ap.parse_args()

    repo = find_repo_root()
    ja_md = repo / "src/content/cv/ja.md"
    en_md = repo / "src/content/cv/en.md"

    ja_text = ja_md.read_text(encoding="utf-8")
    en_text = en_md.read_text(encoding="utf-8") if en_md.exists() else ""
    validate_markers("ja.md", ja_text)
    validate_markers("en.md", en_text)

    orcid_id = args.orcid or read_orcid_id(ja_text, en_text)
    print(f"[orcid-cv-sync] ORCID iD: {orcid_id}", file=sys.stderr)

    data = fetch_orcid_works(orcid_id)
    works = extract_works(data)
    print(
        f"[orcid-cv-sync] ORCID returned {len(works)} unique DOI-bearing works",
        file=sys.stderr,
    )
    funding_data = fetch_orcid_fundings(orcid_id)
    fundings = extract_fundings(funding_data)
    print(
        f"[orcid-cv-sync] ORCID returned {len(fundings)} unique funding records",
        file=sys.stderr,
    )

    # Track ja and en DOI sets independently. The two locales may legitimately
    # diverge (e.g. the user only updates ja.md by hand sometimes), and a
    # paper missing from one file should be re-added there even if the
    # other file already has it. Earlier versions of this script unioned
    # the two sets and silently lost coverage on en.md.
    ja_known = existing_dois(ja_text)
    en_known = existing_dois(en_text)
    print(
        f"[orcid-cv-sync] DOIs already in CV: ja={len(ja_known)}, en={len(en_known)}",
        file=sys.stderr,
    )

    # A work is "new" if it's missing from EITHER file — we'll then decide
    # per-file which side actually needs the addition.
    new_works = [w for w in works if w["doi"] not in ja_known or w["doi"] not in en_known]
    if not new_works:
        print(
            "[orcid-cv-sync] no new publications from ORCID; "
            "checking for superseded preprints.",
            file=sys.stderr,
        )

    # Self-name lookup once up front. Only used to wrap the user's own
    # author entry in <u>...</u>; if it fails, every name is just bold.
    # Skipped when there's nothing to render.
    self_name = (
        None if args.no_crossref or not new_works else fetch_orcid_self_name(orcid_id)
    )
    if self_name:
        print(
            f"[orcid-cv-sync] self-name resolved: {self_name[0]} {self_name[1]}",
            file=sys.stderr,
        )

    def authors_for(doi: str) -> list[dict] | None:
        # `fetch_crossref_work` caches per DOI, so a paper missing from both
        # files costs one request — and the prune's `is-preprint-of` lookup
        # reuses the record the author lookup already pulled.
        return None if args.no_crossref else crossref_authors(doi)

    def build_entries_for(known: set[str]) -> tuple[list[str], list[str], int]:
        """Returns (journal_lines, preprint_lines, duplicate_warnings) for
        works whose DOI is missing from this particular file's `known` set."""
        journal: list[str] = []
        preprint: list[str] = []
        dup_count = 0
        for w in new_works:
            if w["doi"] in known:
                continue
            kind = classify(w["type"], w["doi"])
            title = w["title"] or "(untitled)"
            # Title-based duplicate check uses BOTH file bodies — a hand-
            # written entry on either side should still trigger a warning.
            is_dup = title_already_present(title, ja_text, en_text)
            if is_dup:
                dup_count += 1
            line = format_entry(
                title,
                w.get("journal"),
                w["doi"],
                w["year"],
                authors=authors_for(w["doi"]),
                self_name=self_name,
                possible_duplicate=is_dup,
            )
            (preprint if kind == "preprint" else journal).append(line)
        return journal, preprint, dup_count

    ja_journal, ja_preprint, ja_dups = build_entries_for(ja_known)
    en_journal, en_preprint, en_dups = build_entries_for(en_known)
    ja_funding, ja_funding_dups = build_funding_entries_for(fundings, ja_text, "ja")
    en_funding, en_funding_dups = build_funding_entries_for(fundings, en_text, "en")
    duplicate_warning_count = (
        ja_dups + en_dups + ja_funding_dups + en_funding_dups
    )

    if duplicate_warning_count:
        print(
            f"[orcid-cv-sync] {duplicate_warning_count} entries flagged as POSSIBLE DUPLICATE "
            f"(title matches existing CV text). Review them in the diff before applying.",
            file=sys.stderr,
        )

    ja_added = len(ja_journal) + len(ja_preprint)
    en_added = len(en_journal) + len(en_preprint)
    print(
        f"[orcid-cv-sync] entries to add: ja={ja_added} "
        f"({len(ja_journal)} peer-reviewed, {len(ja_preprint)} preprints), "
        f"en={en_added} ({len(en_journal)} peer-reviewed, {len(en_preprint)} preprints)",
        file=sys.stderr,
    )
    print(
        f"[orcid-cv-sync] funding to add: ja={len(ja_funding)}, "
        f"en={len(en_funding)}",
        file=sys.stderr,
    )

    # Placement is decided purely by the `cv:section` markers, so the two
    # locales share the same kind vocabulary and heading text is irrelevant.
    new_ja = insert_into_section("ja.md", ja_text, "funding", ja_funding)
    new_ja = insert_into_section("ja.md", new_ja, "peer-reviewed", ja_journal)
    new_ja = insert_into_section("ja.md", new_ja, "preprints", ja_preprint)

    new_en = insert_into_section("en.md", en_text, "funding", en_funding)
    new_en = insert_into_section("en.md", new_en, "peer-reviewed", en_journal)
    new_en = insert_into_section("en.md", new_en, "preprints", en_preprint)

    # Prune AFTER inserting, and per file. Running last means one mechanism
    # covers both cases: a preprint already in the CV whose journal version
    # just landed, and a preprint ORCID hands us in the same batch as its
    # journal version (inserted, then pruned, so it never reaches the diff).
    # Per file because ja and en keep independent known-DOI sets — matching a
    # ja preprint against en's peer-reviewed list would delete on the wrong
    # side's evidence.
    if not args.keep_published_preprints:
        new_ja, ja_removed = prune_published_preprints(new_ja, not args.no_crossref)
        new_en, en_removed = prune_published_preprints(new_en, not args.no_crossref)
        for label, removed in (("ja.md", ja_removed), ("en.md", en_removed)):
            for _entry, source, published, via in removed:
                target = f" → {published}" if published else ""
                print(
                    f"[orcid-cv-sync] prune: {label} drops preprint "
                    f"{source or '(no DOI)'}{target} (via {via})",
                    file=sys.stderr,
                )

    # Reported after the prune, which issues CrossRef lookups of its own —
    # tallying before it would under-count.
    if _crossref_failures:
        print(
            f"[orcid-cv-sync] {_crossref_failures} CrossRef lookup(s) failed; "
            f"affected entries have [authors — TODO] placeholders, and any "
            f"preprint whose record we couldn't read was matched by title only.",
            file=sys.stderr,
        )

    changed_ja = show_diff("src/content/cv/ja.md", ja_text, new_ja)
    changed_en = show_diff("src/content/cv/en.md", en_text, new_en)

    if not (changed_ja or changed_en):
        print("[orcid-cv-sync] no changes — CV is up to date.")
        return 0

    if args.apply:
        if changed_ja:
            ja_md.write_text(new_ja, encoding="utf-8")
        if changed_en:
            en_md.write_text(new_en, encoding="utf-8")
        print("[orcid-cv-sync] applied.", file=sys.stderr)
    else:
        print(
            "\n[orcid-cv-sync] dry-run. Re-run with --apply to write changes.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
