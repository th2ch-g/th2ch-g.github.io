// Wires every `.photo-slideshow` element on the page. The first automatic
// advance waits long enough for initial loading metrics to settle; later
// advances use `data-interval` (defaults to 5s). User navigation or an
// explicit speed choice starts the normal interval immediately.
// Listens for a custom `photoslideshow:goto` event so external controls can
// dispatch `{ index, fullscreen }` to jump to a slide and optionally request
// browser fullscreen.

type SlideshowEl = HTMLElement & { __cleanup?: () => void };

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const INITIAL_AUTOPLAY_DELAY = 15_000;

function initSlideshow(root: SlideshowEl) {
  const slides = Array.from(root.querySelectorAll<HTMLElement>('.slide'));
  const progressFill = root.querySelector<HTMLElement>('.progress-fill');
  const progressBar = root.querySelector<HTMLElement>('.progress-bar');
  const progressCurrent = root.querySelector<HTMLElement>('.progress-current');
  if (slides.length < 2) return;

  let interval = Number(root.dataset.interval ?? 5000);
  let current = 0;
  let timer: number | undefined;
  let autoplayEnabled = !reduceMotion;
  let hoverPaused = false;
  let focusPaused = false;
  let keyboardMode = false;
  let swipeStart: { x: number; y: number; pointerId: number } | null = null;

  const loadSlide = (index: number) => {
    const image = slides[index].querySelector<HTMLImageElement>('img[data-src]');
    const source = image?.dataset.src;
    if (!image || !source) return;
    image.src = source;
    image.removeAttribute('data-src');
  };

  const show = (next: number) => {
    const nextIndex = (next + slides.length) % slides.length;
    loadSlide(nextIndex);
    slides[current].classList.remove('active');
    slides[current].setAttribute('aria-hidden', 'true');

    current = nextIndex;

    slides[current].classList.add('active');
    slides[current].setAttribute('aria-hidden', 'false');

    const ratio = ((current + 1) / slides.length) * 100;
    if (progressFill) progressFill.style.width = `${ratio}%`;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(current + 1));
    if (progressCurrent) progressCurrent.textContent = String(current + 1);
  };

  const stop = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  const start = (delay = interval) => {
    stop();
    const inFullscreen = document.fullscreenElement === root;
    const interactionPaused = !inFullscreen && (hoverPaused || focusPaused);
    if (!autoplayEnabled || document.hidden || interactionPaused) return;
    timer = window.setTimeout(() => {
      show(current + 1);
      start();
    }, delay);
  };

  root.querySelectorAll<HTMLButtonElement>('.nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.dataset.dir ?? 1);
      show(current + dir);
      start();
    });
  });

  const swipeSurface = root.querySelector<HTMLElement>('.slides');
  swipeSurface?.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    swipeStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    stop();
  });
  swipeSurface?.addEventListener('pointerup', (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY)) {
      show(current + (deltaX < 0 ? 1 : -1));
    }
    start();
  });
  swipeSurface?.addEventListener('pointercancel', () => {
    swipeStart = null;
    start();
  });

  const speedBtns = Array.from(
    root.querySelectorAll<HTMLButtonElement>('.speed-btn'),
  );
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.speed);
      if (!Number.isFinite(next) || next <= 0) return;
      interval = next;
      // Choosing a speed is an explicit autoplay request, including when
      // the operating system initially reported reduced motion.
      autoplayEnabled = true;
      speedBtns.forEach((b) => b.classList.toggle('active', b === btn));
      start();
    });
  });

  // Pull focus into root synchronously *before* requesting fullscreen.
  // `requestFullscreen()` is async (Promise-returning) so `document.
  // fullscreenElement` does not flip to `root` until the transition
  // completes (~100–500ms). During that gap, arrow-key handling below would
  // bail unless focus is already inside `root` — and on macOS Safari/Firefox
  // a button click does NOT move focus to the button (HIG convention), so
  // we cannot rely on the click target. Forcing focus here closes the gap.
  const enterFullscreen = () => {
    root.focus();
    root.requestFullscreen?.().catch(() => {
      // Browsers without Fullscreen API or user-rejection — ignore.
    });
  };

  const fsBtn = root.querySelector<HTMLButtonElement>('.fullscreen-btn');
  fsBtn?.addEventListener('click', () => {
    if (document.fullscreenElement === root) {
      document.exitFullscreen();
    } else {
      enterFullscreen();
    }
  });

  root.addEventListener('photoslideshow:goto', ((e: Event) => {
    const detail = (e as CustomEvent<{ index?: number; fullscreen?: boolean }>).detail ?? {};
    if (typeof detail.index === 'number') {
      show(detail.index);
      start();
    }
    if (detail.fullscreen && document.fullscreenElement !== root) {
      enterFullscreen();
    }
  }) as EventListener);

  // Belt-and-suspenders: when the transition completes, make sure focus is
  // on root even if the browser dropped it during the transition. Without
  // this, arrow keys would fall back to the `inFullscreen` branch only,
  // which is fine — but explicit focus also keeps `:focus-visible` styles
  // on nested controls coherent when the user tabs around in fullscreen.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === root) {
      // A fullscreen element permanently covers the pointer, so treating
      // `:hover` as a pause would disable autoplay until fullscreen exits.
      hoverPaused = false;
      root.focus();
      start();
      return;
    }

    hoverPaused = root.matches(':hover')
      && window.matchMedia('(hover: hover)').matches;
    if (hoverPaused) stop();
    else start();
  });

  // `pointerenter` also fires after `pointerdown` on touch-only devices.
  // Pausing for every pointer type can therefore leave autoplay stopped on
  // Firefox for Android, where boundary-event ordering differs from desktop
  // browsers. Only hover-capable pointers should control hover pausing.
  root.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch' || document.fullscreenElement === root) return;
    hoverPaused = true;
    stop();
  });
  root.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    hoverPaused = false;
    start();
  });

  // Keep keyboard focus as a pause mechanism without treating persistent
  // touch focus as a pause. Firefox for Android commonly leaves a tapped
  // button focused after the synthetic click sequence.
  document.addEventListener('keydown', () => {
    keyboardMode = true;
  }, true);
  root.addEventListener('pointerdown', () => {
    keyboardMode = false;
    focusPaused = false;
  }, true);
  root.addEventListener('focusin', () => {
    if (!keyboardMode) return;
    focusPaused = true;
    stop();
  });
  root.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
    focusPaused = false;
    start();
  });

  // Arrow-key navigation. Only triggers when this slideshow is the active
  // fullscreen element, or when focus is already inside it (e.g. after the
  // user tabbed to a nav button) — otherwise arrow keys would hijack page
  // scrolling. Bail when the global lightbox overlay is open so its consumers
  // (e.g. masonry tile previews) keep arrow keys for themselves later.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const inFullscreen = document.fullscreenElement === root;
    const hasFocus = root.contains(document.activeElement);
    if (!inFullscreen && !hasFocus) return;
    const lb = document.getElementById('lightbox');
    if (lb && !lb.hidden) return;
    e.preventDefault();
    show(current + (e.key === 'ArrowRight' ? 1 : -1));
    start();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start(INITIAL_AUTOPLAY_DELAY);
  root.__cleanup = stop;
}

export function wireSlideshows(): void {
  document
    .querySelectorAll<SlideshowEl>('.photo-slideshow')
    .forEach(initSlideshow);
}
