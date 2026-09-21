import { onReady } from './dom-ready';

// Keep browser-specific lazy-loading distances from fetching distant tiles.
export function wireGalleryImages(): void {
  onReady(() => {
    const images = document.querySelectorAll<HTMLImageElement>('.masonry img[data-src]');
    const load = (image: HTMLImageElement) => {
      if (!image.dataset.src) return;
      image.src = image.dataset.src;
      image.removeAttribute('data-src');
    };

    if (!('IntersectionObserver' in window)) {
      images.forEach(load);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        load(entry.target as HTMLImageElement);
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '300px 0px' });
    images.forEach((image) => observer.observe(image));
  });
}
