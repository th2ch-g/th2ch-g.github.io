import { onReady } from './dom-ready';

// Wire every button matching `selector` to dispatch a `lightbox:open`
// CustomEvent carrying the complete image set and selected index. The
// listener lives in Lightbox.astro and provides next/previous navigation.
export function wirePhotoLightbox(selector: string): void {
  onReady(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
    const items = buttons.flatMap((btn) => {
      const img = btn.querySelector('img');
      return img
        ? [{ src: img.currentSrc || img.src, alt: img.alt }]
        : [];
    });

    buttons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        if (!items[index]) return;
        document.dispatchEvent(
          new CustomEvent('lightbox:open', {
            detail: { items, index },
          }),
        );
      });
    });
  });
}
