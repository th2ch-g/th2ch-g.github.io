import { onReady } from './dom-ready';

// Mobile hamburger toggle for the site header. `aria-controls` on the button
// resolves to a `<nav>` whose `data-open` attribute drives the responsive
// dropdown CSS in `Header.astro`. Re-uses `onReady` because the page does
// full-document navigation (no ClientRouter) — `astro:page-load` would
// never fire on this site (see CLAUDE.md).
//
// `querySelectorAll` rather than a single `getElementById` keeps this
// resilient if a future layout duplicates the header (e.g. a sticky
// variant). Buttons whose `aria-controls` does not resolve are silently
// skipped — they still render under the desktop CSS, which hides them.
export function wireNavToggles(): void {
  onReady(() => {
    document.querySelectorAll<HTMLButtonElement>('[data-nav-toggle]').forEach((btn) => {
      const navId = btn.getAttribute('aria-controls');
      const nav = navId ? document.getElementById(navId) : null;
      if (!nav) return;
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        nav.dataset.open = String(!open);
      });
    });
  });
}
