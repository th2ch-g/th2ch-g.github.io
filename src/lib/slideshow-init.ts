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
  const progressFill = root.querySelector<HTMLElement>('.slideshow-progress-fill');
  const progressBar = root.querySelector<HTMLElement>('.slideshow-progress-bar');
  const progressCurrent = root.querySelector<HTMLElement>('.slideshow-progress-current');
  if (slides.length === 0) return;

  let interval = Number(root.dataset.interval ?? 5000);
  let current = 0;
  let requested = 0;
  let navigationVersion = 0;
  let switching = false;
  let timer: number | undefined;
  let autoplayEnabled = !reduceMotion;
  let hoverPaused = false;
  let focusPaused = false;
  let keyboardMode = false;
  let swipeStart: { x: number; y: number; pointerId: number } | null = null;

  const slideLoads = new Map<number, Promise<boolean>>();
  const loadSlide = (index: number, priority: 'high' | 'low') => {
    const image = slides[index].querySelector<HTMLImageElement>('img');
    if (!image) return Promise.resolve(false);
    if (priority === 'high' || !slideLoads.has(index)) image.fetchPriority = priority;
    const pending = slideLoads.get(index);
    if (pending) return pending;

    const source = image.dataset.src;
    if (source) {
      image.src = source;
      image.removeAttribute('data-src');
    }
    const ready = image.decode().then(() => true, () => {
      slideLoads.delete(index);
      // Leave the visible slide in place and allow a failed image to retry.
      image.dataset.src = source || image.src;
      // WebKit otherwise reuses the failed request when the same URL is set.
      image.removeAttribute('src');
      return false;
    });
    slideLoads.set(index, ready);
    return ready;
  };

  const prefetchNext = () => {
    if (slides.length > 1) void loadSlide((current + 1) % slides.length, 'low');
  };

  const canAutoplay = () => {
    const inFullscreen = document.fullscreenElement === root;
    const interactionPaused = !inFullscreen && (hoverPaused || focusPaused);
    return slides.length > 1 && autoplayEnabled && !document.hidden && !interactionPaused;
  };

  const show = async (next: number, automatic = false) => {
    stop();
    const nextIndex = ((next % slides.length) + slides.length) % slides.length;
    requested = nextIndex;
    const version = ++navigationVersion;
    switching = true;
    const loaded = await loadSlide(nextIndex, 'high');
    if (version !== navigationVersion) return;
    switching = false;
    if (automatic && !canAutoplay()) {
      requested = current;
      return;
    }
    if (!loaded) {
      start();
      return;
    }
    slides[current].classList.remove('active');
    slides[current].setAttribute('aria-hidden', 'true');

    current = nextIndex;

    slides[current].classList.add('active');
    slides[current].setAttribute('aria-hidden', 'false');

    const ratio = ((current + 1) / slides.length) * 100;
    if (progressFill) progressFill.style.width = `${ratio}%`;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(current + 1));
    if (progressCurrent) progressCurrent.textContent = String(current + 1);
    prefetchNext();
    start();
  };

  const stop = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  const start = (delay = interval) => {
    stop();
    if (switching || !canAutoplay()) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      void show(requested + 1, true);
    }, delay);
  };

  root.querySelectorAll<HTMLButtonElement>('.nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.dataset.dir ?? 1);
      void show(requested + dir);
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
      void show(requested + (deltaX < 0 ? 1 : -1));
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
      speedBtns.forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
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
    if (typeof detail.index === 'number' && Number.isInteger(detail.index)) {
      void show(detail.index);
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
    void show(requested + (e.key === 'ArrowRight' ? 1 : -1));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  // Let the first frame finish before using bandwidth for one adjacent frame.
  void loadSlide(current, 'high').then((loaded) => {
    if (loaded && navigationVersion === 0) prefetchNext();
  });
  start(INITIAL_AUTOPLAY_DELAY);
  root.__cleanup = () => {
    stop();
    navigationVersion++;
  };
}

export function wireSlideshows(): void {
  document
    .querySelectorAll<SlideshowEl>('.photo-slideshow')
    .forEach(initSlideshow);
}
