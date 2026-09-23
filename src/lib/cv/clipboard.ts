import type { BibtexEntry } from '../bibtex';
import { copyToClipboard } from '../clipboard';
export { copyToClipboard as copyBibtex } from '../clipboard';
import { sectionKind, isHeading, getSectionList, extractDoi } from './sections';

export function fontFamilyFor(lang: 'ja' | 'en', isPresentation: boolean): string {
  if (lang !== 'ja') return `'Times New Roman', serif`;
  // Word picks the first family that has a glyph for each codepoint.
  // For presentation entries (heavily Japanese), MS Mincho leads.
  // For other ja entries (heavily English paper titles), Times New
  // Roman leads but MS Mincho still covers any kana/kanji that appear.
  return isPresentation
    ? `'MS Mincho', '游明朝', 'Times New Roman', serif`
    : `'Times New Roman', 'MS Mincho', '游明朝', serif`;
}

// Clone before removing controls so every copy scope leaves the live CV intact.
function cloneContent(element: Element): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.cv-copy-actions, .cv-section-actions, .heading-anchor').forEach((control) => control.remove());
  return clone;
}

function unwrapAnchors(root: HTMLElement): void {
  root.querySelectorAll('a').forEach((a) => {
    const parent = a.parentNode;
    if (!parent) return;
    while (a.firstChild) parent.insertBefore(a.firstChild, a);
    parent.removeChild(a);
  });
}

function stripUnsafeForClipboard(root: HTMLElement): void {
  root.querySelectorAll('script, iframe, object, embed, form, style, link, meta, base').forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

function buildHtml(li: Element, fontFamily: string): string {
  const clone = cloneContent(li);
  unwrapAnchors(clone);
  stripUnsafeForClipboard(clone);
  // Force light foreground/background so Word/text editors don't inherit
  // the page's dark-mode colors (which would paste as black-on-black).
  // font-size in pt (not px/rem) so Word honours it as 10.5pt — the
  // Japanese default body size — instead of converting through DPI.
  return wrapForClipboard(clone.innerHTML, fontFamily);
}

function buildPlainText(li: Element): string {
  const clone = cloneContent(li);
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export async function copyItem(li: Element, fontFamily: string): Promise<boolean> {
  return copyToClipboard(buildPlainText(li), buildHtml(li, fontFamily));
}

function buildFullHtml(prose: HTMLElement, lang: 'ja' | 'en'): string {
  const clone = cloneContent(prose);
  unwrapAnchors(clone);
  stripUnsafeForClipboard(clone);

  if (lang !== 'ja') {
    const ff = fontFamilyFor('en', false);
    return wrapForClipboard(clone.innerHTML, ff);
  }

  const blocks: string[] = [];
  let currentKind = '';
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    const isPres = currentKind === 'presentations';
    blocks.push(wrapForClipboard(buffer, fontFamilyFor('ja', isPres)));
    buffer = '';
  };
  Array.from(clone.children).forEach((el) => {
    if (isHeading(el)) {
      flush();
      // The kind lives on the section's list, so look ahead from the
      // heading rather than reading the heading's own text. Any heading
      // level starts a new block — the CV is free to use `#` or `###`.
      currentKind = sectionKind(getSectionList(el));
    }
    buffer += el.outerHTML;
  });
  flush();
  return blocks.join('');
}

function wrapForClipboard(innerHtml: string, fontFamily: string): string {
  return `<div style="font-family:${fontFamily};font-size:10.5pt;color:#000;background-color:#ffffff;line-height:1.6;">${innerHtml}</div>`;
}

const normWs = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

function renderListLines(list: Element, depth: number, lines: string[]): void {
  const ordered = list.tagName === 'OL';
  let idx = 0;
  Array.from(list.children).forEach((li) => {
    if (li.tagName !== 'LI') return;
    idx += 1;
    const indent = '  '.repeat(depth);
    const bullet = ordered ? `${idx}. ` : '- ';
    // Pull this <li>'s own text without descending into nested lists.
    const own = Array.from(li.childNodes)
      .filter((n) => !(n instanceof Element && (n.tagName === 'OL' || n.tagName === 'UL')))
      .map((n) => n.textContent)
      .join('');
    lines.push(indent + bullet + normWs(own));
    li.querySelectorAll(':scope > ol, :scope > ul').forEach((nested) => {
      renderListLines(nested, depth + 1, lines);
    });
  });
}

function buildFullPlainText(prose: HTMLElement): string {
  const clone = cloneContent(prose);
  const lines: string[] = [];
  Array.from(clone.children).forEach((el) => {
    const tag = el.tagName;
    if (isHeading(el)) {
      lines.push('', normWs(el.textContent), '');
    } else if (tag === 'OL' || tag === 'UL') {
      renderListLines(el, 0, lines);
      lines.push('');
    } else if (tag === 'P') {
      lines.push(normWs(el.textContent), '');
    }
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function copyAll(prose: HTMLElement, lang: 'ja' | 'en'): Promise<boolean> {
  return copyToClipboard(buildFullPlainText(prose), buildFullHtml(prose, lang));
}

function getSectionTitle(heading: Element): string {
  const clone = cloneContent(heading);
  return normWs(clone.textContent);
}

export function collectSectionBibtex(heading: Element, list: Element, entries: Record<string, BibtexEntry>): string | null {
  const out: string[] = [];
  list.querySelectorAll<HTMLElement>(':scope > li').forEach((li) => {
    const doi = extractDoi(li);
    const bib = doi ? entries[doi]?.bibtex : null;
    if (bib) out.push(bib);
  });
  if (out.length === 0) return null;
  const title = getSectionTitle(heading);
  return `# ${title}\n\n${out.join('\n\n')}`;
}

function buildSectionHtml(heading: Element, list: Element, fontFamily: string): string {
  const headingClone = cloneContent(heading);
  unwrapAnchors(headingClone);
  const listClone = cloneContent(list);
  unwrapAnchors(listClone);
  stripUnsafeForClipboard(headingClone);
  stripUnsafeForClipboard(listClone);
  return wrapForClipboard(headingClone.outerHTML + listClone.outerHTML, fontFamily);
}

function buildSectionPlainText(heading: Element, list: Element): string {
  const clone = cloneContent(list);
  const lines: string[] = [getSectionTitle(heading), ''];
  renderListLines(clone, 0, lines);
  return lines.join('\n');
}

export async function copySection(heading: Element, list: Element, fontFamily: string): Promise<boolean> {
  return copyToClipboard(buildSectionPlainText(heading, list), buildSectionHtml(heading, list, fontFamily));
}
