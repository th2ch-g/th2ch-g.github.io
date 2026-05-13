// Run `fn` once when the DOM is ready. Astro defers module scripts but does
// NOT dispatch `astro:page-load` because this site doesn't use ClientRouter
// (see CLAUDE.md). A defer script may be parsed either before or after
// DOMContentLoaded, so we branch on `readyState` to handle both cases —
// adding a DOMContentLoaded listener after the event has already fired
// would never run.
export function onReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}
