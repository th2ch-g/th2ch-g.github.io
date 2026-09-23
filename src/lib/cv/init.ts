import type { Lang } from '../../i18n/ui';
import type { BibtexEntry } from '../bibtex';
import { buildCopyButton, buildCopyMenu, setupCopyMenuDismissal } from './actions';
import { copyAll, copyBibtex, copyItem, copySection, collectSectionBibtex, fontFamilyFor } from './clipboard';
import { extractDoi, getSectionList, isPublicationKind, sectionKind } from './sections';

function readSnapshot<T>(value: string | undefined): Record<string, T> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, T> : {};
  } catch {
    return {};
  }
}

export function setupCv(): void {
  const prose = document.querySelector<HTMLElement>('.cv-prose[data-cv-lang]');
  if (!prose || prose.dataset.cvReady === '1') return;
  prose.dataset.cvReady = '1';
  const lang: Lang = prose.dataset.cvLang === 'en' ? 'en' : 'ja';
  const copyLabel = prose.dataset.copyLabel ?? 'Copy';
  const sectionCopyLabel = prose.dataset.sectionCopyLabel ?? 'Copy list';
  const bibtexEntries = readSnapshot<BibtexEntry>(prose.dataset.bibtex);

  // Nested annotations remain part of their parent entry's clipboard payload.
  prose.querySelectorAll<HTMLElement>(':scope > ol > li, :scope > ul > li').forEach((li) => {
    const kind = sectionKind(li.parentElement);
    const font = fontFamilyFor(lang, kind === 'presentations');
    const doi = isPublicationKind(kind) ? extractDoi(li) : null;
    const bibtex = doi ? bibtexEntries[doi]?.bibtex : null;
    const actions = document.createElement('div');
    actions.className = 'cv-copy-actions';
    actions.appendChild(bibtex
      ? buildCopyMenu(copyLabel, 'cv-copy-btn', [
          { label: prose.dataset.itemTextLabel ?? 'Text', run: () => copyItem(li, font) },
          { label: prose.dataset.bibtexLabel ?? 'BibTeX', run: () => copyBibtex(bibtex) },
        ])
      : buildCopyButton('cv-copy-btn', { label: copyLabel, run: () => copyItem(li, font) }, 1600));
    li.classList.add('cv-copyable');
    if (bibtex) li.classList.add('cv-has-bibtex');
    li.appendChild(actions);
  });

  // An outer heading claims a shared list before any of its subheadings.
  const claimedLists = new Set<Element>();
  prose.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    const list = getSectionList(heading);
    if (!list || claimedLists.has(list)) return;
    claimedLists.add(list);
    const kind = sectionKind(list);
    const font = fontFamilyFor(lang, kind === 'presentations');
    const bibtex = isPublicationKind(kind) ? collectSectionBibtex(heading, list, bibtexEntries) : null;
    const actions = document.createElement('span');
    actions.className = 'cv-section-actions';
    const copyList = { label: sectionCopyLabel, run: () => copySection(heading, list, font) };
    actions.appendChild(bibtex
      ? buildCopyMenu(prose.dataset.sectionMenuAria ?? 'Copy options', 'cv-section-btn', [
          copyList,
          { label: prose.dataset.sectionBibtexLabel ?? 'All as BibTeX', run: () => copyBibtex(bibtex) },
        ])
      : buildCopyButton('cv-section-btn cv-section-copy', copyList));
    heading.classList.add('cv-section-heading');
    heading.appendChild(actions);
  });

  const headerActions = document.querySelector<HTMLElement>('[data-cv-actions]');
  if (headerActions) {
    const fullBib = Object.values(bibtexEntries).map((entry) => entry.bibtex).filter(Boolean).join('\n\n') + '\n';
    headerActions.appendChild(buildCopyMenu(headerActions.dataset.menuAria ?? 'CV actions', 'cv-header-btn', [
      { label: headerActions.dataset.labelAll ?? 'Copy all', run: () => copyAll(prose, lang) },
      { label: headerActions.dataset.labelBib ?? 'Copy .bib', run: () => copyBibtex(fullBib) },
    ]));
  }
  setupCopyMenuDismissal();
}
