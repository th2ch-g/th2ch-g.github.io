// Wires every `.photo-slideshow` element on the page. Auto-advances to
// the next slide every `data-interval` ms (defaults to 5s), stops while
// the user hovers / focuses inside the carousel, and resumes on leave.
// Listens for a custom `photoslideshow:goto` event so the masonry grid
// in PhotosListPage can act as a lightbox: dispatch `{ index, fullscreen }`
// to jump to a slide and optionally request browser fullscreen.

type SlideshowEl = HTMLElement & { __cleanup?: () => void };

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initSlideshow(root: SlideshowEl) {
  const slides = Array.from(root.querySelectorAll<HTMLElement>('.slide'));
  const progressFill = root.querySelector<HTMLElement>('.progress-fill');
  const progressBar = root.querySelector<HTMLElement>('.progress-bar');
  const progressCurrent = root.querySelector<HTMLElement>('.progress-current');
  if (slides.length < 2) return;

  let interval = Number(root.dataset.interval ?? 5000);
  let current = 0;
  let timer: number | undefined;

  const show = (next: number) => {
    slides[current].classList.remove('active');
    slides[current].setAttribute('aria-hidden', 'true');

    current = (next + slides.length) % slides.length;

    slides[current].classList.add('active');
    slides[current].setAttribute('aria-hidden', 'false');

    const ratio = ((current + 1) / slides.length) * 100;
    if (progressFill) progressFill.style.width = `${ratio}%`;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(current + 1));
    if (progressCurrent) progressCurrent.textContent = String(current + 1);
  };

  const start = () => {
    if (reduceMotion) return;
    stop();
    timer = window.setInterval(() => show(current + 1), interval);
  };
  const stop = () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  root.querySelectorAll<HTMLButtonElement>('.nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.dataset.dir ?? 1);
      show(current + dir);
      start();
    });
  });

  const speedBtns = Array.from(
    root.querySelectorAll<HTMLButtonElement>('.speed-btn'),
  );
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.speed);
      if (!Number.isFinite(next) || next <= 0) return;
      interval = next;
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
    if (document.fullscreenElement === root) root.focus();
  });

  root.addEventListener('pointerenter', stop);
  root.addEventListener('pointerleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);

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

  start();
  root.__cleanup = stop;
}

export function wireSlideshows(): void {
  document
    .querySelectorAll<SlideshowEl>('.photo-slideshow')
    .forEach(initSlideshow);
}
