---
name: orcid-cv-sync
description: Sync newly published peer-reviewed papers and preprints from the ORCID Public API into the bilingual CV (src/content/cv/ja.md and en.md) on this bilingual Astro portfolio. Use whenever the user wants to refresh their publications list, pull from ORCID, "ORCIDから取り込み", "CV更新", "論文一覧をアップデート", "publications を同期", "新しい論文を CV に入れて", or whenever a paper has just been published and the CV is likely stale. The skill is strictly additive — it never overwrites existing manual entries — and respects the existing peer-reviewed / preprint section split. Both ja.md and en.md receive the same updates.
---

# Sync publications from ORCID into the CV

This portfolio's CV pages (`src/content/cv/ja.md` and `src/content/cv/en.md`) carry hand-written publication sections. ORCID is the source of truth for *new* journal articles and preprints; this skill picks up entries from ORCID that aren't already on either file and proposes additions. It does not modify or delete anything that's already there — that's a constraint, not a default.

## When to invoke

Trigger on phrases like:
- "ORCID から取り込み" / "ORCID 同期"
- "CV を更新して" (when the context is publications, not e.g. job history)
- "新しい論文を入れて" / "publications をアップデート"
- "論文一覧を最新に"

The user may not say "ORCID" explicitly. If they ask to refresh the publications list and `src/content/cv/ja.md` declares an `orcid:` key, this skill is the right tool.

## Workflow

1. Confirm `src/content/cv/ja.md` declares `orcid:` in its frontmatter and that the publication lists are wrapped in `<!-- cv:section … -->` markers (see "Where the config lives" below). The script auto-detects both; it does **not** read `profile.yaml`.
2. Run a dry-run first to show the user what will change:
   ```bash
   uv run scripts/sync_cv.py
   ```
   If `uv` isn't available, fall back to `python3 scripts/sync_cv.py`. The script has zero third-party dependencies (only Python stdlib), so any Python 3.9+ works.
3. The script prints a unified diff for both `ja.md` and `en.md`. Show this to the user verbatim. Do not summarize — they need to see the exact lines being added.
4. Ask the user to confirm. If they approve, re-run with `--apply`:
   ```bash
   uv run scripts/sync_cv.py --apply
   ```
5. After applying, run `npm run check` to confirm the content schema still parses (the profile collection has no required fields, so this should always pass; doing it anyway catches accidental yaml frontmatter corruption).

## What the script does

`scripts/sync_cv.py` does the following, in order:

1. Reads the `orcid:` frontmatter key from `src/content/cv/ja.md` (falling back to `en.md`; a mismatch between the two is a hard error)
2. Fetches `https://pub.orcid.org/v3.0/<iD>/works` with `Accept: application/json` — **no authentication required**, the ORCID Public API is anonymous-readable
3. Fetches `https://pub.orcid.org/v3.0/<iD>/person` once to resolve the record holder's display name. Used only to wrap the user's own author entry in `<u>...</u>` so it stands out visually (matches the existing CV style). If this call fails, every author is just bold.
4. Reads `ja.md` and `en.md` and extracts every existing DOI via regex `10\.\d{4,9}/[-._;()/:A-Za-z0-9]+`. **The two files have independent "known" sets** so a paper missing from only one side gets added to that side. (Earlier versions unioned them and silently lost coverage on `en.md` whenever a DOI was already in `ja.md`.)
5. For each ORCID work, checks whether its DOI is in **each file's** known set; the work is added only to the files where it's missing
5b. Additionally normalizes each ORCID work's title (strip everything but `[a-z0-9]`) and checks whether it appears as a substring of either CV file. If yes, the entry is **still added but marked with a visible `<!-- POSSIBLE DUPLICATE -->` HTML comment** so the user can review and remove it from the diff. We don't skip in this case because preprint→journal pairs share titles but have different DOIs and both deserve a CV line
6. For each new work, classifies as **preprint** or **peer-reviewed** using:
   - ORCID `type == "preprint"`, OR
   - DOI prefix in the known preprint-server list: `10.1101` (bioRxiv), `10.48550` (arXiv), `10.31219` (OSF/medRxiv), `10.20944` (Preprints.org), `10.64898` (ChemRxiv)
   - otherwise → peer-reviewed (journal article)
7. For each new work, queries `https://api.crossref.org/works/<DOI>` to fetch the author list (ORCID itself does not return authors). Each author is rendered as **bold name**; the user's own name (matched on family name + first given-name token) is wrapped in `<u>...</u>`. CrossRef failure is non-fatal — that entry falls back to the `[authors — TODO]` placeholder for manual filling later. The request identifies itself with a plain `orcid-cv-sync/1.0` User-Agent — no contact address, so it uses CrossRef's public pool rather than the "polite pool" (slightly slower queue, no auth, no signup).
8. Sorts new works by their ORCID publication date in descending order, formats each entry as a numbered list item (using the `1.` marker — CommonMark auto-numbers them, mirroring the conference-presentations sections), and inserts them directly after the matching `<!-- cv:section … -->` marker in both `ja.md` and `en.md` (blank lines right after the marker are skipped so a tight list stays tight). **A missing marker is a hard error** — the script never invents a heading or guesses a location.

## Output format

Each new entry is a Markdown ordered-list item, mirroring the numbered style used by the conference-presentations sections of the CV. Every line uses the literal marker `1.`; CommonMark renders them as 1, 2, 3, … automatically. Keep this style — switching to `-` mid-section breaks numbering because Markdown treats `1.` and `-` as separate lists:

```
1. **Given Family**, **<u>Self Family</u>**, **Other Author**, [Title](https://doi.org/{doi}), *{journal-title}*, DOI:{doi}, ({year}).
```

Notes on this format:
- Authors are taken from CrossRef (`given` + `family` joined). The record holder's family name (resolved from ORCID's `/person` endpoint) is wrapped in `<u>...</u>` for visual emphasis.
- If CrossRef fails (network blip, rate limit, missing record), the line uses the plain-text placeholder `[authors — TODO]` instead of an author list. **Do not** convert this to `<!-- TODO: authors -->` — Astro / remark treat a leading HTML comment in a list item as a raw HTML block and silently disable ALL Markdown formatting on the line (links and emphasis leak through as literal `[...]` and `*...*` characters in the rendered HTML). After the run, find placeholders with `grep -n "authors — TODO" src/content/cv/*.md` and fill them by hand.
- Pass `--no-crossref` to skip the CrossRef step deliberately — useful when the user explicitly wants to fill authors by hand or CrossRef is offline.
- Co-first-author asterisks (`*`) and other annotations cannot be derived from CrossRef. If the paper has them, edit the line by hand after running.
- If `journal-title` is missing in ORCID, that part is omitted; the same goes for `year`.
- The `POSSIBLE DUPLICATE` warning, when emitted, is appended to the **end** of the line as an HTML comment. Trailing inline comments are safe — only leading ones break the parser.

## Where the config lives

Everything the sync needs is stated by the CV files themselves — heading text carries no meaning, so sections can be renamed or translated freely without touching this skill.

Frontmatter (both locales; validated by the `cv` schema in `src/content.config.ts`):

```yaml
---
orcid: 0009-0001-3991-8367
---
```

Body markers, wrapping each publication list:

```markdown
## 論文(査読付き)
<!-- cv:section peer-reviewed -->
1. ...
<!-- /cv:section -->
```

- `kind` vocabulary is locale-independent and identical in `ja.md` / `en.md`: `peer-reviewed`, `preprints`, `presentations`. The script writes only into the first two; `presentations` exists for the CV page.
- `src/plugins/remark-cv-sections.mjs` consumes the markers at build time and stamps `data-cv-section="<kind>"` on each wrapped list, which is how `CVPage.astro` decides where the BibTeX button goes and which clipboard font to use. Marker names are therefore a contract shared by the skill and the site — don't rename one side alone.
- **Markers must sit outside the list.** A comment line between two list items splits the `<ol>`, restarting CommonMark's auto-numbering so every entry renders as "1.".
- Unbalanced markers (`cv:section` without `/cv:section`) abort the run before anything is fetched.

## Authors note

Authors are **auto-fetched from CrossRef** using each paper's DOI (ORCID itself does not return author lists). The record holder's family name (resolved once from ORCID's `/person` endpoint) is wrapped in `<u>...</u>` so the user's own entry stands out — this matches the established CV style.

CrossRef cannot encode every annotation a CV needs:
- Co-first-author asterisks (`*`) and "contributed equally" notes
- Affiliation-specific footnotes
- Press releases, awards, related links

If the paper carries any of these, edit the freshly-added line by hand after the run.

When CrossRef is unreachable (network blip, rate limit, missing record), the script falls back to the plain-text `[authors — TODO]` placeholder. Find them with:

```bash
grep -n "authors — TODO" src/content/cv/*.md
```

Pass `--no-crossref` to opt out of CrossRef explicitly — useful for offline runs or when the user prefers to type all authors by hand.

## Edge cases

- **Existing CV entry has no DOI**: e.g. the user originally wrote a paper into `ja.md` by hand without including the DOI link, and ORCID has now picked it up. DOI-based comparison can't catch this, but the **title-substring check** will, and the new entry will be marked `<!-- POSSIBLE DUPLICATE -->` in the diff. The user should review and either delete the new line (real duplicate) or backfill a `DOI:` link into the existing manual entry so the next sync recognizes it.
- **Same paper as preprint and journal article** (different DOIs, same title): both will be added. The journal version gets a `<!-- POSSIBLE DUPLICATE -->` marker because its title matches the preprint entry already in the CV. The user removes the marker (it's intentionally a separate entry) and optionally deletes the preprint line.
- **DOI in ja.md uses non-standard formatting** (e.g. `DOI:10.xxx` without a URL): the regex still matches the DOI substring, so it counts as known.
- **Section renamed / translated**: no effect. Placement follows the `cv:section` markers, so `## 論文(査読付き)` can become `## Peer-reviewed papers` freely.
- **Marker missing for a section that has new entries**: the script aborts with the exact marker it wanted (`<!-- cv:section preprints -->`) and writes nothing. Add the marker pair around the list and re-run.
- **ORCID returns no works**: script exits cleanly with "no new publications — CV is up to date."
- **Network failure**: script raises and exits non-zero; user can re-run later.

## Constraints (non-negotiable)

- **Never modify or delete existing entries.** Only append.
- **Stay on the public/free APIs only.** Currently used: ORCID Public API (`pub.orcid.org`) and CrossRef (`api.crossref.org`). Both are anonymous-readable. Don't add Semantic Scholar, OpenAlex, GitHub, or anything that needs a key without explicit user opt-in.
- **Never commit changes automatically.** Always show the diff and let the user run `git add` / `git commit` themselves.

## After running

- Inspect the diff. If anything looks wrong (e.g. a journal article was mis-classified as preprint), edit `ja.md` / `en.md` by hand to move the line to the correct section.
- Fill in author lists where the `<!-- TODO: authors -->` markers were inserted.
- Commit the changes with a message like `Sync publications from ORCID`.
