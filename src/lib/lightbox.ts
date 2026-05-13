import { onReady } from './dom-ready';

// Wire every button matching `selector` to dispatch a `lightbox:open`
// CustomEvent carrying the inner <img>'s effective src + alt. Used by
// HomePage and PhotosListPage; the listener lives in Lightbox.astro.
export function wirePhotoLightbox(selector: string): void {
  onReady(() => {
    document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.addEventListener('click', () => {
        const img = btn.querySelector('img');
        if (!img) return;
        document.dispatchEvent(
          new CustomEvent('lightbox:open', {
            detail: { src: img.currentSrc || img.src, alt: img.alt },
          }),
        );
      });
    });
  });
}
