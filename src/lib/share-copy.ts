import { onReady } from './dom-ready';
import { copyToClipboard } from './clipboard';

// Wire up every `.share-copy` button on the page. Each button knows its
// share URL via `data-share-url` and its localised label states via
// `data-label-{copy,copied,failed}`. The toast is the sibling element
// inside `.share-copy-wrap` — paired per-button so multi-share groups
// (currently unused but cheap to support) don't cross-fire.
export function wireShareCopyButtons(): void {
  onReady(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.share-copy');
    buttons.forEach((btn) => {
      const wrap = btn.closest<HTMLElement>('.share-copy-wrap');
      const toast = wrap?.querySelector<HTMLElement>('[data-share-toast]') ?? null;
      btn.addEventListener('click', async () => {
        const url = btn.dataset.shareUrl ?? location.href;
        const copied = btn.dataset.labelCopied ?? 'Copied';
        const failed = btn.dataset.labelFailed ?? 'Copy failed';
        const original = btn.dataset.labelCopy ?? btn.getAttribute('aria-label') ?? '';
        const ok = await copyToClipboard(url);
        const stateClass = ok ? 'is-copied' : 'is-failed';
        const label = ok ? copied : failed;
        btn.classList.add(stateClass);
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        if (toast) {
          toast.textContent = label;
          toast.classList.toggle('is-success', ok);
          toast.classList.toggle('is-error', !ok);
          toast.hidden = false;
          // Force reflow so the `is-visible` class triggers the CSS transition
          // even when set on a freshly-unhidden element.
          void toast.offsetWidth;
          toast.classList.add('is-visible');
        }
        window.setTimeout(() => {
          btn.classList.remove(stateClass);
          btn.setAttribute('aria-label', original);
          btn.setAttribute('title', original);
          if (toast) {
            toast.classList.remove('is-visible');
            // Re-hide after the fade-out finishes so it's removed from the
            // a11y tree and document flow until the next click.
            window.setTimeout(() => { toast.hidden = true; }, 220);
          }
        }, 1600);
      });
    });
  });
}
