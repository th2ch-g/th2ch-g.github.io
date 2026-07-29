// Global image preview overlay controller. The corresponding markup is
// rendered once by Lightbox.astro. Gallery buttons open it explicitly
// through the `lightbox:open` custom event.

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

  document.addEventListener('lightbox:open', ((e: Event) => {
    const detail = (e as CustomEvent<{ src?: string; alt?: string }>).detail;
    if (!detail?.src) return;
    open(detail.src, detail.alt ?? '');
  }) as EventListener);
}
