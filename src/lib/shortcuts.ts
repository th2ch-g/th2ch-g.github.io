import { onReady } from './dom-ready';
import { hasOpenModal } from './modal-focus';
import { getRelativeLocaleUrl } from './locale-url';

export function wireShortcuts(): void {
  onReady(() => {
    const dialog = document.querySelector<HTMLDialogElement>('[data-shortcuts-dialog]');
    if (!dialog || dialog.dataset.shortcutsReady) return;
    dialog.dataset.shortcutsReady = '1';
    const destinations: Record<string, string> = { h: '/', b: '/posts', p: '/gallery', c: '/#cv' };
    let pendingTimer: number | undefined;
    const clearChord = () => {
      window.clearTimeout(pendingTimer);
      pendingTimer = undefined;
    };

    document.addEventListener('keydown', (event) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey
        || (event.target instanceof HTMLElement
          && (event.target.isContentEditable || event.target.closest('input, textarea, select')))
        || hasOpenModal()) {
        clearChord();
        return;
      }
      if (pendingTimer !== undefined) {
        const path = destinations[event.key.toLowerCase()];
        clearChord();
        if (path) {
          event.preventDefault();
          const lang = document.documentElement.lang === 'ja' ? 'ja' : 'en';
          location.href = getRelativeLocaleUrl(lang, path);
        }
        return;
      }
      if (event.key === 'g') {
        pendingTimer = window.setTimeout(clearChord, 1200);
      } else if (event.key === '/') {
        const trigger = document.querySelector<HTMLButtonElement>('[data-search-open]');
        if (trigger) {
          event.preventDefault();
          trigger.click();
        }
      } else if (event.key === '?') {
        event.preventDefault();
        dialog.showModal();
      }
    });
    window.addEventListener('blur', clearChord);
    dialog.querySelector('[data-shortcuts-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}
