// Section markers, rather than heading text or level, define CV semantics.
export const sectionKind = (list: Element | null | undefined): string =>
  list?.getAttribute('data-cv-section') ?? '';

export const isPublicationKind = (kind: string): boolean =>
  kind === 'peer-reviewed' || kind === 'preprints';

export const isHeading = (el: Element): boolean => /^H[1-6]$/.test(el.tagName);

const headingLevel = (el: Element): number => Number(el.tagName.slice(1));

export function getSectionList(heading: Element): Element | null {
  const level = headingLevel(heading);
  let cur = heading.nextElementSibling;
  while (cur) {
    if (isHeading(cur)) {
      if (headingLevel(cur) <= level) return null;
    } else if (cur.tagName === 'OL' || cur.tagName === 'UL') {
      return cur;
    }
    cur = cur.nextElementSibling;
  }
  return null;
}

export function extractDoi(li: Element): string | null {
  const a = li.querySelector<HTMLAnchorElement>('a[href*="doi.org/"]');
  if (!a) return null;
  const m = a.href.match(/doi\.org\/(10\.[0-9]{4,9}\/[^\s)>"']+)/i);
  if (!m) return null;
  return decodeURIComponent(m[1]).toLowerCase().replace(/[.,;]+$/, '');
}
