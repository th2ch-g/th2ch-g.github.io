// Global image preview overlay controller. The corresponding markup
// (`#lightbox`) is rendered once by `Lightbox.astro` and mounted on every
// page via Base.astro. This controller listens (via document-level event
// delegation) for sustained pointer hovers on card images in posts
// and gallery entries; after HOLD_MS of continuous hover the hovered
// image is copied here and the overlay fades in. Click anywhere or press
// Esc to close. Also exposes a `lightbox:open` CustomEvent so callers
// (e.g. the gallery's photo-btn) can open a specific image directly.

const HOLD_MS = 800;

// Card image targets for hover-to-preview: posts (`.thumb img`), gallery list
// (`.img-wrap img`), photo detail page cover (`.cover`). The gallery masonry
// (`.photo-btn img`) is intentionally excluded — it opens only on click via
// the `lightbox:open` event dispatched by `wirePhotoLightbox`.
const SELECTOR = [
  '.card .thumb img',
  '.card .img-wrap img',
  '.photo-card .img-wrap img',
  'img.cover',
].join(',');

export function wireLightbox(): void {
  const lb = document.getElementById('lightbox') as HTMLElement | null;
  const lbImg = lb?.querySelector<HTMLImageElement>('.lightbox-img');
  const lbClose = lb?.querySelector<HTMLButtonElement>('.lightbox-close');

  function open(src: string, alt: string) {
    if (!lb || !lbImg) return;
    lbImg.src = src;
    lbImg.alt = alt;
    lb.hidden = false;
    requestAnimationFrame(() => lb.classList.add('open'));
  }

  function close() {
    if (!lb) return;
    lb.classList.remove('open');
    setTimeout(() => {
      if (lb && !lb.classList.contains('open')) lb.hidden = true;
    }, 240);
  }

  lb?.addEventListener('click', () => close());
  lbClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lb && !lb.hidden) close();
  });

  let timer: number | undefined;
  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  // Event delegation: one handler at document level catches all matching imgs,
  // including those inside slideshow lists where DOM gets re-evaluated.
  document.addEventListener('pointerover', (e) => {
    const target = e.target as Element | null;
    const img = target?.closest?.(SELECTOR) as HTMLImageElement | null;
    if (!img) return;
    clear();
    timer = window.setTimeout(() => open(img.currentSrc || img.src, img.alt), HOLD_MS);
  });
  document.addEventListener('pointerout', (e) => {
    const target = e.target as Element | null;
    if (target?.closest?.(SELECTOR)) clear();
  });
  // Cancel pending zoom if the user starts clicking (they intend to navigate).
  document.addEventListener('pointerdown', clear);

  // External "open this image now" entry point — used by the gallery's
  // photo-btn click handler to act as a lightbox without going browser
  // fullscreen. Keeps Lightbox internals encapsulated; callers just
  // dispatch `lightbox:open` with `{ src, alt }`.
  document.addEventListener('lightbox:open', ((e: Event) => {
    const detail = (e as CustomEvent<{ src?: string; alt?: string }>).detail;
    if (!detail?.src) return;
    clear();
    open(detail.src, detail.alt ?? '');
  }) as EventListener);
}
