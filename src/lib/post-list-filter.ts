import { wireChipCollapse } from './chip-collapse';

export function setupPostListFilter(): void {
  const root = document.querySelector<HTMLElement>('[data-posts-filter]');
  const list = document.querySelector<HTMLElement>('[data-post-list]');
  if (!root || !list) return;
  const listElement = list;

  const rows = Array.from(listElement.querySelectorAll<HTMLElement>('[data-post-row]'));
  const years = Array.from(listElement.querySelectorAll<HTMLElement>('[data-post-year]'));
  const rowsByYear = new Map(
    years.map((year) => [
      year,
      Array.from(year.querySelectorAll<HTMLElement>('[data-post-row]')),
    ]),
  );
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-facet="tag"]'));
  const sortButton = root.querySelector<HTMLButtonElement>('[data-sort-toggle]');
  const emptyMessage = document.querySelector<HTMLElement>('[data-empty-msg]');
  const url = new URL(location.href);
  const knownTags = chips.map((chip) => chip.dataset.value ?? '');
  let activeTag = url.searchParams.get('tag') ?? '';
  if (!knownTags.includes(activeTag)) activeTag = '';

  const initialSort = url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc';

  function rowTags(row: HTMLElement): string[] {
    try {
      const parsed = JSON.parse(row.dataset.tags ?? '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  function applyFilter() {
    let visibleTotal = 0;
    rows.forEach((row) => {
      const visible = !activeTag || rowTags(row).includes(activeTag);
      row.hidden = !visible;
      if (visible) visibleTotal += 1;
    });

    years.forEach((year) => {
      const visibleCount = (rowsByYear.get(year) ?? []).filter((row) => !row.hidden).length;
      year.hidden = visibleCount === 0;
      const count = year.querySelector<HTMLElement>('[data-year-count]');
      if (count) count.textContent = `(${visibleCount})`;
    });

    chips.forEach((chip) => {
      chip.classList.toggle('is-active', (chip.dataset.value ?? '') === activeTag);
    });
    if (emptyMessage) emptyMessage.hidden = visibleTotal !== 0;
  }

  function applySort(direction: 'asc' | 'desc') {
    years.forEach((year) => {
      const container = year.querySelector<HTMLElement>('[data-year-items]');
      if (!container) return;
      const originalRows = rowsByYear.get(year) ?? [];
      const orderedRows = direction === 'desc' ? originalRows : [...originalRows].reverse();
      orderedRows.forEach((row) => container.append(row));
    });

    const orderedYears = direction === 'desc' ? years : [...years].reverse();
    orderedYears.forEach((year) => listElement.append(year));
    listElement.dataset.sort = direction;

    if (!sortButton) return;
    const label = direction === 'desc'
      ? (sortButton.dataset.labelNewest ?? 'Newest first')
      : (sortButton.dataset.labelOldest ?? 'Oldest first');
    sortButton.setAttribute('aria-label', label);
    const labelElement = sortButton.querySelector('.sort-label');
    const arrowElement = sortButton.querySelector('.sort-arrow');
    if (labelElement) labelElement.textContent = label;
    if (arrowElement) arrowElement.textContent = direction === 'desc' ? '↓' : '↑';
  }

  function syncUrl() {
    const next = new URL(location.href);
    if (activeTag) next.searchParams.set('tag', activeTag);
    else next.searchParams.delete('tag');
    if (listElement.dataset.sort === 'asc') next.searchParams.set('sort', 'asc');
    else next.searchParams.delete('sort');
    history.replaceState(null, '', `${next.pathname}${next.search}`);
  }

  applySort(initialSort);
  applyFilter();

  const chipGroup = root.querySelector<HTMLElement>('[data-collapsible]');
  if (chipGroup) {
    wireChipCollapse(chipGroup, {
      moreTemplate: chipGroup.dataset.moreLabel ?? '+ {n}',
      lessLabel: chipGroup.dataset.lessLabel ?? '− less',
    });
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      activeTag = chip.dataset.value ?? '';
      applyFilter();
      syncUrl();
    });
  });

  sortButton?.addEventListener('click', () => {
    const direction = listElement.dataset.sort === 'desc' ? 'asc' : 'desc';
    applySort(direction);
    syncUrl();
  });
}
