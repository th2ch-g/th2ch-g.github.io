#!/usr/bin/env python3
"""Sync new publications from the ORCID Public API into the bilingual CV.

Reads ORCID iD from ``src/content/profile.yaml`` (the link with a URL
under ``orcid.org``), fetches works from ``pub.orcid.org`` (no authentication
required), and inserts any DOIs not already present in ``ja.md`` / ``en.md``
into the matching section.

For each new work, also queries the CrossRef API by DOI to fetch the author
list (ORCID itself does not return authors). Each author is rendered as a
bold name; the record holder's own name (resolved from ORCID's ``/person``
endpoint) is wrapped in ``<u>...</u>`` to match the existing CV style.
CrossRef lookup failures fall back to a ``[authors — TODO]`` placeholder
so a network blip never breaks the script.

Strictly additive: existing entries are never modified or removed. The script
emits a unified diff in dry-run mode (default); pass ``--apply`` to write.

Usage:
    uv run scripts/sync_cv.py            # dry-run
    uv run scripts/sync_cv.py --apply    # write changes
    uv run scripts/sync_cv.py --orcid 0000-0000-0000-0000   # override ORCID iD
    uv run scripts/sync_cv.py --no-crossref   # skip CrossRef, use [authors — TODO]

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
ORCID_RE = re.compile(r"https?://orcid\.org/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])")
NORMALIZE_RE = re.compile(r"[^a-z0-9]")


def normalize(s: str) -> str:
    """Strip everything but a-z 0-9 and lowercase. Used for fuzzy title
    matching against the existing CV body — diacritics, punctuation, and
    whitespace would otherwise prevent obvious duplicates from matching."""
    return NORMALIZE_RE.sub("", s.lower())


def title_already_present(title: str | None, *texts: str) -> bool:
    """Return True if the normalized title is a substring of any of `texts`.
    Skip very short titles (< 20 chars after normalization) since the false-
    positive risk dominates — generic titles like "Introduction" would match
    too aggressively."""
    if not title:
        return False
    norm_t = normalize(title)
    if len(norm_t) < 20:
        return False
    for text in texts:
        if norm_t in normalize(text):
            return True
    return False


def find_repo_root() -> Path:
    """Walk up from cwd until we find ``src/content/profile.yaml``."""
    p = Path.cwd().resolve()
    while True:
        if (p / "src" / "content" / "profile.yaml").exists():
            return p
        if p == p.parent:
            raise SystemExit(
                "Could not find repo root — run this from the project tree.",
            )
        p = p.parent


def read_orcid_id(profile_yaml: Path) -> str:
    text = profile_yaml.read_text(encoding="utf-8")
    m = ORCID_RE.search(text)
    if not m:
        raise SystemExit(
            "ORCID iD not found in profile.yaml — expected an "
            "https://orcid.org/<iD> URL among the links.",
        )
    return m.group(1)


def fetch_orcid_works(orcid_id: str) -> dict:
    url = f"https://pub.orcid.org/v3.0/{orcid_id}/works"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.URLError as e:
        raise SystemExit(f"ORCID API request failed: {e}") from e


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


# Patterns for pulling siteHandle / repo / site out of profile.yaml without
# a real YAML parser (the script declares zero third-party deps above).
SITEHANDLE_RE = re.compile(r"^siteHandle:\s*(\S+)\s*$", re.MULTILINE)
REPO_RE = re.compile(r"^repo:\s*(\S+)\s*$", re.MULTILINE)
SITE_RE = re.compile(r"^site:\s*(\S+)\s*$", re.MULTILINE)


def build_crossref_ua(profile_yaml: Path) -> str:
    """Construct a CrossRef "polite pool" User-Agent from profile.yaml.

    Including a contact in the User-Agent gets requests onto a faster,
    less-throttled queue. Pure cooperative convention — no auth or signup
    needed. See https://api.crossref.org/swagger-ui/index.html
    """
    text = profile_yaml.read_text(encoding="utf-8")
    handle_m = SITEHANDLE_RE.search(text)
    repo_m = REPO_RE.search(text)
    site_m = SITE_RE.search(text)
    if not (handle_m and repo_m and site_m):
        raise SystemExit(
            "Could not extract siteHandle / repo / site from profile.yaml "
            "(needed to build the CrossRef polite-pool User-Agent).",
        )
    handle = handle_m.group(1).strip()
    repo_slug = repo_m.group(1).strip()
    host = (
        site_m.group(1)
        .strip()
        .removeprefix("https://")
        .removeprefix("http://")
        .rstrip("/")
    )
    return (
        f"{handle}-portfolio-orcid-cv-sync/1.0 "
        f"(+https://github.com/{repo_slug}; "
        f"mailto:noreply@{host})"
    )


def fetch_crossref_authors(doi: str, crossref_ua: str) -> list[dict] | None:
    """Return ``[{given, family}, ...]`` from CrossRef, or ``None`` on failure.

    A failure here is non-fatal — the caller falls back to the
    ``[authors — TODO]`` placeholder so the user can fill the line in by
    hand later.
    """
    url = f"https://api.crossref.org/works/{urllib.request.quote(doi, safe='/')}"
    req = urllib.request.Request(url, headers={"User-Agent": crossref_ua})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.load(resp)
    except urllib.error.URLError as e:
        print(
            f"[orcid-cv-sync] WARN: CrossRef lookup failed for {doi}: {e}",
            file=sys.stderr,
        )
        return None
    raw_authors = data.get("message", {}).get("author") or []
    out: list[dict] = []
    for a in raw_authors:
        given = (a.get("given") or "").strip()
        family = (a.get("family") or "").strip()
        if family:
            out.append({"given": given, "family": family})
    return out or None


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
        work_type = ws.get("type", "") or ""
        out.append(
            {
                "doi": doi,
                "title": title,
                "journal": journal,
                "year": year,
                "month": month,
                "type": work_type,
            },
        )
    return out


def section_span(content: str, header_pattern: str) -> tuple[int, int] | None:
    """Locate a section by header. Returns (header_idx, next_section_or_eof)
    in line indices, or None if the header isn't present."""
    lines = content.splitlines(keepends=True)
    pattern = re.compile(header_pattern)
    start = None
    for i, line in enumerate(lines):
        if pattern.match(line.rstrip("\n")):
            start = i
            break
    if start is None:
        return None
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            return (start, j)
    return (start, len(lines))


def insert_into_section(
    content: str,
    header_pattern: str,
    fallback_header: str,
    entries: list[str],
) -> str:
    """Append `entries` to the section matching `header_pattern`. If absent,
    append a new section using `fallback_header` at the end of the file."""
    if not entries:
        return content
    block = "\n".join(entries) + "\n"
    span = section_span(content, header_pattern)
    if span is None:
        sep = "" if content.endswith("\n") else "\n"
        return f"{content}{sep}\n{fallback_header}\n\n{block}"
    _, end = span
    lines = content.splitlines(keepends=True)
    return "".join(lines[:end]) + block + "".join(lines[end:])


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
        description="Sync new ORCID publications into the CV",
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default: dry-run, prints diff only)",
    )
    ap.add_argument(
        "--orcid",
        help="Override ORCID iD (otherwise read from profile.yaml)",
    )
    ap.add_argument(
        "--no-crossref",
        action="store_true",
        help="Skip CrossRef author lookup; emit [authors — TODO] placeholder",
    )
    args = ap.parse_args()

    repo = find_repo_root()
    profile_yaml = repo / "src/content/profile.yaml"
    ja_md = repo / "src/content/cv/ja.md"
    en_md = repo / "src/content/cv/en.md"

    orcid_id = args.orcid or read_orcid_id(profile_yaml)
    crossref_ua = build_crossref_ua(profile_yaml)
    print(f"[orcid-cv-sync] ORCID iD: {orcid_id}", file=sys.stderr)

    data = fetch_orcid_works(orcid_id)
    works = extract_works(data)
    print(
        f"[orcid-cv-sync] ORCID returned {len(works)} unique DOI-bearing works",
        file=sys.stderr,
    )

    ja_text = ja_md.read_text(encoding="utf-8")
    en_text = en_md.read_text(encoding="utf-8") if en_md.exists() else ""

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
        print("[orcid-cv-sync] no new publications — CV is up to date.")
        return 0

    # Self-name lookup once up front. Only used to wrap the user's own
    # author entry in <u>...</u>; if it fails, every name is just bold.
    self_name = None if args.no_crossref else fetch_orcid_self_name(orcid_id)
    if self_name:
        print(
            f"[orcid-cv-sync] self-name resolved: {self_name[0]} {self_name[1]}",
            file=sys.stderr,
        )

    # Build entries per file. CrossRef lookup is cached per-DOI so we don't
    # double-fetch when the same paper is missing from both files.
    crossref_cache: dict[str, list[dict] | None] = {}
    crossref_failures = 0

    def authors_for(doi: str) -> list[dict] | None:
        nonlocal crossref_failures
        if args.no_crossref:
            return None
        if doi not in crossref_cache:
            res = fetch_crossref_authors(doi, crossref_ua)
            if res is None:
                crossref_failures += 1
            crossref_cache[doi] = res
        return crossref_cache[doi]

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
    duplicate_warning_count = ja_dups + en_dups

    if crossref_failures:
        print(
            f"[orcid-cv-sync] {crossref_failures} CrossRef lookup(s) failed; "
            f"those entries have [authors — TODO] placeholders.",
            file=sys.stderr,
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

    # When we have to *create* a section header from scratch (typical for an
    # empty en.md), mirror the ja.md style by linking the heading to the
    # ORCID profile URL. This way the rendered ja and en CV pages have the
    # same visual structure: a clickable section title that takes the
    # reader to the canonical publication list. The detection regex is
    # tolerant of the link wrapper (`\[?...\]?`) so the same skill run can
    # update existing files whether they're written with or without the link.
    orcid_url = f"https://orcid.org/{orcid_id}"

    new_ja = insert_into_section(
        ja_text,
        r"^## \[?論文\(査読付き\)\]?",
        f"## [論文(査読付き)]({orcid_url})",
        ja_journal,
    )
    new_ja = insert_into_section(
        new_ja,
        r"^## \[?論文\(プレプリント",
        f"## [論文(プレプリント, 査読無し)]({orcid_url})",
        ja_preprint,
    )

    new_en = insert_into_section(
        en_text,
        r"^## \[?Publications \(peer-reviewed\)\]?",
        f"## [Publications (peer-reviewed)]({orcid_url})",
        en_journal,
    )
    new_en = insert_into_section(
        new_en,
        r"^## \[?Publications \(preprints\)\]?",
        f"## [Publications (preprints)]({orcid_url})",
        en_preprint,
    )

    changed_ja = show_diff("src/content/cv/ja.md", ja_text, new_ja)
    changed_en = show_diff("src/content/cv/en.md", en_text, new_en)

    if not (changed_ja or changed_en):
        print(
            "[orcid-cv-sync] nothing to apply (unexpected — already up to date).",
            file=sys.stderr,
        )
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
