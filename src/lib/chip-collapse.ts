// Collapses a chip-filter group beyond `threshold` chips, appending a
// "+N / less" toggle. Static one-shot wiring (no observers) — chip lists
// are server-rendered and never mutated after page load.
//
// The toggle element is itself a `.chip`, but it carries no
// `[data-tag-filter]` / `[data-facet]` attribute, so it is invisible to
// the surrounding filter logic that queries those attributes.
//
// Labels are passed in (rather than hard-coded) so callers can localize.
// `moreTemplate` MUST contain `{n}` — replaced at render time.

export interface ChipCollapseOptions {
  threshold?: number;
  moreTemplate: string;
  lessLabel: string;
}

export function wireChipCollapse(container: HTMLElement, opts: ChipCollapseOptions): void {
  if (container.dataset.collapseWired === '1') return;
  const threshold = opts.threshold ?? 5;

  const chips = Array.from(container.querySelectorAll<HTMLElement>('.chip'));
  // Need strictly more than threshold + 1 chips for the toggle to be a net
  // win — otherwise the toggle just replaces a single chip and saves nothing.
  if (chips.length <= threshold + 1) return;

  const hiddenChips = chips.slice(threshold);
  // Per-chip index for the CSS stagger (`--reveal-i` -> transition-delay).
  hiddenChips.forEach((c, i) => c.style.setProperty('--reveal-i', String(i)));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'chip chip-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  container.appendChild(toggle);

  // Open by default if the URL-driven active chip lives in the hidden tail —
  // otherwise the user lands on a page with their selection out of sight.
  let expanded = hiddenChips.some((c) => c.classList.contains('is-active'));
  render();

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });

  function render() {
    hiddenChips.forEach((c) => c.classList.toggle('chip-hidden', !expanded));
    toggle.textContent = expanded
      ? opts.lessLabel
      : opts.moreTemplate.replace('{n}', String(hiddenChips.length));
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  container.dataset.collapseWired = '1';
}
