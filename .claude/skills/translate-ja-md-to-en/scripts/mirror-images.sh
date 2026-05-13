#!/usr/bin/env bash
# mirror-images.sh — link sibling assets of a JA content .md into its EN twin's directory.
#
# Why symlinks instead of copies:
#   The image is the same photo regardless of caption language. Hard-copying
#   means a future edit on ja/ side leaves en/ silently stale. Relative symlinks
#   keep one source of truth and stay in sync automatically.
#
# Why *relative* symlinks:
#   `../ja/cover.svg` resolves correctly anywhere the repo is checked out
#   (host, Docker bind mount, CI runners), because the relation between ja/ and
#   en/ is fixed inside the repo and never crosses absolute filesystem paths.
#
# Why this is safe:
#   - Astro's image() helper and Vite's asset pipeline follow symlinks
#     transparently (Node `fs.readFile` does by default).
#   - Git stores symlinks portably (mode 120000 + relative target string);
#     they survive checkout on Linux/macOS and on Windows with
#     `git config core.symlinks true` / Developer Mode.
#   - GitHub Pages builds on Linux runners, so symlinks resolve in CI.
#
# Usage:
#   bash .claude/skills/translate-ja-md-to-en/scripts/mirror-images.sh \
#     src/content/blog/ja/2026-05-07-hello-world.md
#
#   # If you really want hard copies instead (e.g. you intend the EN image to
#   # diverge from JA later), pass --copy:
#   bash mirror-images.sh src/content/.../ja/foo.md --copy
#
# Behavior:
#   - Refuses to run on a path that doesn't contain `/ja/`.
#   - Creates the EN directory if it doesn't exist.
#   - For each sibling file matching `<slug>.*` (except the .md itself),
#     creates a relative symlink en/<file> -> ../ja/<file>.
#   - Skips entries already present in en/ (whether file, dir, or symlink).
#   - Idempotent — safe to re-run.

set -euo pipefail

mode="symlink"
src_md=""

for arg in "$@"; do
  case "$arg" in
    --copy) mode="copy" ;;
    --symlink) mode="symlink" ;;
    -h|--help)
      sed -n '2,/^set/p' "$0" | sed 's/^# \{0,1\}//' | head -n -1
      exit 0 ;;
    *)
      if [[ -z "$src_md" ]]; then
        src_md="$arg"
      else
        echo "error: unexpected argument: $arg" >&2
        exit 2
      fi ;;
  esac
done

if [[ -z "$src_md" ]]; then
  echo "usage: $0 <path-to-ja.md> [--copy|--symlink]" >&2
  exit 2
fi

if [[ ! -f "$src_md" ]]; then
  echo "error: file not found: $src_md" >&2
  exit 1
fi

if [[ "$src_md" != *"/ja/"* ]]; then
  echo "error: expected a path containing '/ja/', got: $src_md" >&2
  exit 1
fi

# Build the EN-side path by splitting at the FIRST `/ja/` segment.
prefix="${src_md%%/ja/*}"
suffix="${src_md#*/ja/}"
dst_md="${prefix}/en/${suffix}"

src_dir="$(dirname "$src_md")"
dst_dir="$(dirname "$dst_md")"
slug="$(basename "$src_md" .md)"

mkdir -p "$dst_dir"

shopt -s nullglob
linked=0
copied=0
skipped=0
for f in "$src_dir/$slug".*; do
  base="$(basename "$f")"
  # Skip the source markdown itself; we never auto-create the EN .md.
  [[ "$base" == "$slug.md" ]] && continue
  target="$dst_dir/$base"

  if [[ -e "$target" || -L "$target" ]]; then
    printf '  skip     %s (already exists)\n' "$base"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ "$mode" == "symlink" ]]; then
    ln -s "../ja/$base" "$target"
    printf '  linked   %s -> ../ja/%s\n' "$base" "$base"
    linked=$((linked + 1))
  else
    cp "$f" "$target"
    printf '  copied   %s\n' "$base"
    copied=$((copied + 1))
  fi
done

if [[ "$linked" -eq 0 && "$copied" -eq 0 && "$skipped" -eq 0 ]]; then
  echo "  (nothing matched '$slug.*' next to the source — no images to mirror)"
fi

echo "done. EN target: $dst_md"
