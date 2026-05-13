---
name: translate-ja-md-to-en
description: Translate Japanese Markdown content files to English Markdown for this bilingual Astro portfolio. Use this skill any time the user wants to translate, mirror, port, or create an English version of a `.md` file under `src/content/` (papers, presentations, works, photos, blog, profile). Trigger on phrases like "英訳して", "英語版を作って", "/en にミラー", "translate to English", "mirror this to /en/", "this needs an English version", "make an en/ counterpart", or whenever a `src/content/<collection>/ja/<slug>.md` file exists without an `en/<slug>.md` sibling. The skill preserves frontmatter keys, dates, URLs, DOIs, file paths, code blocks, and BibTeX verbatim while translating titles, descriptions, prose, image alts, and captions into natural, technically-accurate English. Also handles copying co-located image files from `ja/` to `en/`.
---

# Translate Japanese Markdown → English Markdown

This bilingual Astro portfolio is set up so that every public-facing piece of content lives under `src/content/<collection>/{ja,en}/<slug>.md`. Authoring is done in Japanese first; this skill produces the English mirror.

## When to invoke

Invoke whenever any of the following are true:

- The user asks to translate, mirror, port, or "make an English version" of a `.md` file in this repo.
- The user references a `src/content/.../ja/<slug>.md` and the corresponding `.../en/<slug>.md` is missing.
- The user pastes Japanese markdown and asks for an English version.
- The user is editing a Japanese content file and says something like "もう英語の方も" / "EN版も同じく".

If the file in question is not under `src/content/`, fall back to general-purpose translation but still apply the preservation rules below — they are good defaults for any technical Markdown.

## Repository invariants (do not break)

1. **Slug must match across locales.** `ja/2026-05-07-hello-world.md` ↔ `en/2026-05-07-hello-world.md`. URLs, the language switcher, and `getStaticPaths()` all assume identical filenames.
2. **Frontmatter keys are English already** (defined by Zod schemas in `src/content.config.ts`). Do **not** rename them. Only the *values* may need translation, and only some of them.
3. **Co-located image filenames must mirror** between `ja/` and `en/` so frontmatter `./<slug>.cover.svg` paths resolve in both. Use the bundled `scripts/mirror-images.sh`, which by default creates **relative symlinks** (`en/foo.svg` → `../ja/foo.svg`) so a single image file backs both locales — edits to the source stay in sync automatically and Astro dedupes the output asset. Pass `--copy` only if you intentionally want the EN image to diverge from the JA original.
4. **Markdown body structure stays the same** — same heading hierarchy, same code blocks, same images in the same positions. Translate the prose, not the layout.

## Per-collection field rules

Look up the collection by the parent directory (`src/content/<collection>/...`). For each frontmatter field decide: **translate**, **copy verbatim**, or **drop**.

### `papers/`

| Field | Action | Notes |
|-------|--------|-------|
| `title` | translate | Use the paper's official English title if known; otherwise translate naturally. |
| `authors` | verbatim | Already in romaji per repo convention. |
| `venue` | verbatim | Conference/journal names are proper nouns. |
| `year`, `type`, `doi`, `pdf`, `url` | verbatim | Identifiers, dates, URLs. |
| `bibtex` | verbatim | Never edit BibTeX. |
| `award` | translate | e.g. "最優秀論文賞" → "Best Paper Award". |
| `featured` | verbatim | Boolean. |
| Body | translate | Abstract, supplementary notes — natural academic English. |

### `presentations/`

| Field | Action |
|-------|--------|
| `title` | translate |
| `venue` | verbatim if it has an official name, else translate (e.g. "日本化学会春季大会" → "CSJ Spring Meeting"); if unsure, romanize and add a parenthetical English gloss |
| `location` | translate to standard English place names ("東京" → "Tokyo, Japan") |
| `date`, `type`, `slides`, `coAuthors` | verbatim |
| `abstract` | translate |
| Body | translate |

### `works/`

| Field | Action |
|-------|--------|
| `name` | verbatim (project names are identifiers) |
| `description` | translate (one-line) |
| `repo`, `homepage`, `languages`, `tags`, `status`, `startedAt`, `featured` | verbatim |
| `image`, `imageAlt` | path verbatim, alt translate |
| Body | translate (preserve fenced code blocks exactly) |

### `photos/`

| Field | Action |
|-------|--------|
| `title` | translate |
| `date` | verbatim |
| `coverImage`, `coverImageAlt` | path verbatim, alt translate |
| `gallery` (array of `{src, alt, caption}`) | `src` verbatim, `alt` and `caption` translate |
| `location` | translate to standard English |
| `camera` | verbatim (proper noun + spec string) |
| `tags`, `featured` | verbatim |
| Body | translate |

### `blog/`

| Field | Action |
|-------|--------|
| `title`, `description` | translate |
| `pubDate`, `updatedDate`, `tags`, `draft` | verbatim |
| `heroImage`, `heroImageAlt` | path verbatim, alt translate |
| Body | translate |

### `profile/` (single-file: `ja.md` ↔ `en.md`)

| Field | Action |
|-------|--------|
| `name` | verbatim |
| `headline`, `affiliation`, `location` | translate |
| `email`, `avatar` | verbatim |
| `links[].label` | translate (e.g. "個人サイト" → "Personal site"); URLs verbatim |
| Body | translate |

## Body translation rules

- **Preserve every fenced code block byte-for-byte.** Code, command-line examples, BibTeX, JSON, YAML — all verbatim. Do not translate identifiers, comments, or string literals inside code blocks.
- **Inline code** \`like this\` — preserve verbatim.
- **Links** `[text](url)`: translate the link text, keep the URL.
- **Images** `![alt](./path.jpg)`: translate the alt text, keep the relative path identical so the same image file is referenced.
- **Headings**: translate, but keep the same depth (`##` stays `##`).
- **Lists, tables, blockquotes**: preserve structure; translate cell contents.
- **HTML embedded in Markdown** (rare): preserve tags and attributes; translate only visible text content.

## Style guide for the English output

- Aim for **natural, idiomatic English written by a researcher/engineer**, not a literal gloss. Re-flow sentences if a literal translation reads awkwardly.
- Prefer **concise, direct phrasing**. Drop fillers like "なお" / "ちなみに" unless they carry real meaning.
- **Person names**: standard romanization with given-name-first ordering. Keep consistent with the JA `authors` array which is already in romaji.
- **Place names**: standard English ("東京" → "Tokyo, Japan", "大阪大学" → "Osaka University").
- **Technical terms**: use the field-standard English term, not a literal translation. ("分子動力学シミュレーション" → "molecular dynamics simulation", not "molecule dynamics simulation").
- **Acronyms / initialisms**: keep them as written. Spell out at first use only if the JA original did.
- **Tone**: match the original. A casual blog post stays casual; an academic abstract stays formal.
- **Avoid hallucinating content** — never add facts, citations, or claims that weren't in the JA source.

## Workflow

Given a Japanese source file (typically the user has it open or names it), follow these steps:

1. **Identify the source path.** Confirm it matches the pattern `src/content/<collection>/ja/<slug>.md`. If not, ask before proceeding.
2. **Compute the target path.** Replace `/ja/` with `/en/` in the path. The slug (filename) stays identical.
3. **Mirror co-located images** by running the bundled script from the repo root:
   ```bash
   bash .claude/skills/translate-ja-md-to-en/scripts/mirror-images.sh <source-md-path>
   ```
   This creates a **relative symlink** in the `en/` directory for every sibling file matching `<slug>.*` (except the `.md` itself). One image file backs both locales, so editing the source updates both pages and Astro dedupes the asset in `dist/`. Idempotent — files already present in `en/` are skipped. Pass `--copy` if you specifically want a hard copy that can diverge later.
4. **Translate the file.** Apply the per-collection rules above. Write the output to the target path with the `Write` tool. Do not modify the JA source. **Do not append any translator attribution line** — the file ends with translated content only.
5. **Sanity-check the result** by glancing at the new file: are all frontmatter keys still present? Are paths and dates unchanged? Are code blocks intact?
6. **Verify the build still passes** if the user wants confirmation:
   ```bash
   npm run check && npm run build
   ```
   Or, if the dev container is running, just refresh `http://localhost:4321/en/<route>/<slug>/` — Astro's HMR shows the result immediately.

## Examples

### Example 1 — blog post frontmatter

Input (`src/content/blog/ja/2026-05-07-hello-world.md`):
```yaml
---
title: ポートフォリオサイトを作りました
description: Astro でポートフォリオサイトを構築した記録。
pubDate: 2026-05-07
tags:
  - astro
  - meta
heroImage: ./2026-05-07-hello-world.cover.svg
heroImageAlt: Hello, portfolio. のヒーロー画像
---
```

Output (`src/content/blog/en/2026-05-07-hello-world.md`):
```yaml
---
title: Launching this portfolio site
description: Notes on building a portfolio with Astro.
pubDate: 2026-05-07
tags:
  - astro
  - meta
heroImage: ./2026-05-07-hello-world.cover.svg
heroImageAlt: Hello, portfolio. hero image
---
```

Note: `pubDate`, `tags`, and the `heroImage` path are byte-identical. `title`, `description`, and `heroImageAlt` are translated. The path `./2026-05-07-hello-world.cover.svg` resolves correctly because the SVG was mirrored to `en/` by the script.

### Example 2 — body with code blocks and images

Input:
```markdown
## 写真の貼り方

本文中に画像を入れるときは、この `.md` と同じディレクトリに画像ファイルを置いて
相対パスで参照する。例:

```markdown
![代替テキスト](./my-photo.jpg)
```

下のサンプルはヒーロー用の SVG をそのまま本文中にも貼ったもの。

![インライン画像のデモ](./2026-05-07-hello-world.cover.svg)
```

Output:
```markdown
## How to add photos

To embed an image in the body, drop the file next to this `.md` and reference it
with a relative path. Example:

```markdown
![alt text](./my-photo.jpg)
```

The image below is the hero SVG, embedded inline as a demo:

![inline image demo](./2026-05-07-hello-world.cover.svg)
```

Note: the inner code block (the ` ```markdown ... ``` ` example) is preserved verbatim including the JA-style filename `./my-photo.jpg`. Only the prose around it is translated. The actual image reference at the end has its alt translated; the path is unchanged.

### Example 3 — photo gallery

Input (`src/content/photos/ja/sample-photo.md`):
```yaml
---
title: サンプル写真投稿
date: 2026-05-07
location: 東京, 日本
camera: iPhone 17 Pro
coverImage: ./sample-photo.cover.svg
coverImageAlt: 緑色のサンプルカバー画像
gallery:
  - src: ./sample-photo.shot-1.svg
    alt: 黄色のサンプル画像
    caption: 1枚目のキャプション
---
```

Output:
```yaml
---
title: A sample photo post
date: 2026-05-07
location: Tokyo, Japan
camera: iPhone 17 Pro
coverImage: ./sample-photo.cover.svg
coverImageAlt: Green sample cover image
gallery:
  - src: ./sample-photo.shot-1.svg
    alt: Yellow sample image
    caption: Caption for the first shot
---
```

## Things to ask before translating

If any of these are unclear, ask the user briefly rather than guessing:

- The paper has an **official English title** that you can't infer (e.g. it differs significantly from the literal translation). Confirm before fabricating.
- The conference/journal name is unfamiliar — ask whether to keep romaji or use an English form.
- The proper noun (lab, group, project name) might have a preferred English spelling.
- The body uses a non-obvious technical term where there are multiple acceptable English renderings.

When in doubt, prefer the user's existing terminology. Grep `src/content/en/` for prior translations of the same term to stay consistent.
