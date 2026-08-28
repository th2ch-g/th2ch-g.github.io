// Collapse a long filter group behind a localized "+N / less" toggle.
export interface ChipCollapseOptions {
  threshold?: number;
  moreTemplate: string;
  lessLabel: string;
}

export const DEFAULT_CHIP_COLLAPSE_THRESHOLD = 5;

export function wireChipCollapse(container: HTMLElement, opts: ChipCollapseOptions): void {
  if (container.dataset.collapseWired === '1') return;
  const threshold = opts.threshold ?? DEFAULT_CHIP_COLLAPSE_THRESHOLD;
  const chips = Array.from(container.querySelectorAll<HTMLElement>('.chip:not(.chip-toggle)'));
  if (chips.length <= threshold + 1) return;

  const hiddenChips = chips.slice(threshold);
  hiddenChips.forEach((chip, index) => chip.style.setProperty('--reveal-i', String(index)));

  const existingToggle = container.querySelector<HTMLButtonElement>('.chip-toggle');
  const toggle = existingToggle ?? document.createElement('button');
  if (!existingToggle) {
    toggle.type = 'button';
    toggle.className = 'chip chip-toggle';
    container.appendChild(toggle);
  }

  let expanded = hiddenChips.some((chip) => chip.classList.contains('is-active'));

  function render() {
    hiddenChips.forEach((chip) => chip.classList.toggle('chip-hidden', !expanded));
    toggle.textContent = expanded
      ? opts.lessLabel
      : opts.moreTemplate.replace('{n}', String(hiddenChips.length));
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });

  render();
  container.dataset.collapseWired = '1';
}
