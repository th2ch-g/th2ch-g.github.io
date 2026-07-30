// Global image preview overlay controller. The corresponding markup is
// rendered once by Lightbox.astro. Gallery buttons open it explicitly
// through the `lightbox:open` custom event.

export function wireLightbox(): void {
  const lb = document.getElementById('lightbox') as HTMLElement | null;
  const lbImg = lb?.querySelector<HTMLImageElement>('.lightbox-img');
  const lbClose = lb?.querySelector<HTMLButtonElement>('.lightbox-close');
  const lbPrev = lb?.querySelector<HTMLButtonElement>('.lightbox-prev');
  const lbNext = lb?.querySelector<HTMLButtonElement>('.lightbox-next');
  const lbCount = lb?.querySelector<HTMLElement>('.lightbox-count');
  const lbCurrent = lb?.querySelector<HTMLElement>('.lightbox-current');
  const lbTotal = lb?.querySelector<HTMLElement>('.lightbox-total');

  type LightboxItem = { src: string; alt?: string };
  let items: LightboxItem[] = [];
  let current = 0;
  let previouslyFocused: HTMLElement | null = null;
  let swipeStart: { x: number; y: number; pointerId: number } | null = null;

  function show(index: number) {
    if (!lb || !lbImg) return;
    current = (index + items.length) % items.length;
    const item = items[current];
    if (!item) return;
    lbImg.src = item.src;
    lbImg.alt = item.alt ?? '';
    if (lbCurrent) lbCurrent.textContent = String(current + 1);
  }

  function syncNavigation() {
    const hasMultiple = items.length > 1;
    if (lbPrev) lbPrev.hidden = !hasMultiple;
    if (lbNext) lbNext.hidden = !hasMultiple;
    if (lbCount) lbCount.hidden = !hasMultiple;
    if (lbTotal) lbTotal.textContent = String(items.length);
  }

  function open(nextItems: LightboxItem[], index: number) {
    if (!lb || !lbImg || nextItems.length === 0) return;
    items = nextItems;
    current = 0;
    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    show(index);
    syncNavigation();
    lb.hidden = false;
    document.body.classList.add('lightbox-open');
    requestAnimationFrame(() => {
      lb.classList.add('open');
      lbClose?.focus();
    });
  }

  function close() {
    if (!lb) return;
    lb.classList.remove('open');
    setTimeout(() => {
      if (lb && !lb.classList.contains('open')) lb.hidden = true;
    }, 240);
    document.body.classList.remove('lightbox-open');
    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  lb?.addEventListener('click', (event) => {
    if (event.target === lb) close();
  });
  lbClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  lbPrev?.addEventListener('click', (event) => {
    event.stopPropagation();
    show(current - 1);
  });
  lbNext?.addEventListener('click', (event) => {
    event.stopPropagation();
    show(current + 1);
  });
  document.addEventListener('keydown', (e) => {
    if (!lb || lb.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && items.length > 1) {
      e.preventDefault();
      show(current - 1);
    } else if (e.key === 'ArrowRight' && items.length > 1) {
      e.preventDefault();
      show(current + 1);
    }
  });

  lbImg?.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || items.length < 2) return;
    swipeStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  });
  lbImg?.addEventListener('pointerup', (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    show(current + (deltaX < 0 ? 1 : -1));
  });
  lbImg?.addEventListener('pointercancel', () => {
    swipeStart = null;
  });

  document.addEventListener('lightbox:open', ((e: Event) => {
    const detail = (e as CustomEvent<{
      items?: LightboxItem[];
      index?: number;
      src?: string;
      alt?: string;
    }>).detail;
    if (detail?.items?.length) {
      open(detail.items, detail.index ?? 0);
    } else if (detail?.src) {
      open([{ src: detail.src, alt: detail.alt }], 0);
    }
  }) as EventListener);
}
