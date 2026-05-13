import { onReady } from './dom-ready';

// Heading-anchor click handler. rehype-autolink-headings produces
// `<a class="heading-anchor" href="#slug">#</a>`. The default browser
// behavior already navigates to the anchor; we additionally copy the
// full URL (with hash) so the user can paste a deep link elsewhere.
// Browsers without clipboard access still get default anchor navigation;
// no further action needed in the catch branch.
export function wireHeadingAnchorCopy(): void {
  onReady(() => {
    document.querySelectorAll<HTMLAnchorElement>('.prose .heading-anchor').forEach((a) => {
      a.addEventListener('click', async () => {
        const url = new URL(a.getAttribute('href') ?? '', location.href).toString();
        try {
          await navigator.clipboard.writeText(url);
          a.classList.add('is-copied');
          window.setTimeout(() => a.classList.remove('is-copied'), 1200);
        } catch {
          // Browsers without clipboard access still get default anchor navigation.
        }
      });
    });
  });
}
