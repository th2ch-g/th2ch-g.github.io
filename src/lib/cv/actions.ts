import { COPY_ICON, CHECK_ICON } from '../copy-icons';

interface CopyAction {
  label: string;
  run: () => Promise<boolean>;
}

const feedbackTimers = new WeakMap<HTMLElement, number>();

function showFeedback(trigger: HTMLElement, state: HTMLElement, ok: boolean, duration: number): void {
  window.clearTimeout(feedbackTimers.get(state));
  trigger.innerHTML = ok ? CHECK_ICON : COPY_ICON;
  state.classList.toggle('is-copied', ok);
  state.classList.toggle('is-failed', !ok);
  feedbackTimers.set(state, window.setTimeout(() => {
    trigger.innerHTML = COPY_ICON;
    state.classList.remove('is-copied', 'is-failed');
    feedbackTimers.delete(state);
  }, duration));
}

function closeMenu(details: HTMLDetailsElement, restoreFocus = false): void {
  const hadFocus = details.contains(document.activeElement);
  details.open = false;
  if (restoreFocus && hadFocus) details.querySelector('summary')?.focus({ preventScroll: true });
}

export function buildCopyButton(className: string, action: CopyAction, duration = 1800): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className} btn btn-ghost btn-sm`;
  button.innerHTML = COPY_ICON;
  button.setAttribute('aria-label', action.label);
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    showFeedback(button, button, await action.run(), duration);
  });
  return button;
}

export function buildCopyMenu(label: string, sizingClass: string, actions: CopyAction[]): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'cv-menu';
  const summary = document.createElement('summary');
  summary.className = `${sizingClass} cv-menu-trigger btn btn-ghost btn-sm`;
  summary.innerHTML = COPY_ICON;
  summary.setAttribute('aria-label', label);
  const list = document.createElement('div');
  list.className = 'cv-menu-list';
  for (const action of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'cv-menu-item btn btn-ghost btn-sm';
    item.textContent = action.label;
    item.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await action.run();
      showFeedback(summary, details, ok, 1800);
      closeMenu(details, true);
    });
    list.appendChild(item);
  }
  details.append(summary, list);
  return details;
}

export function setupCopyMenuDismissal(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll<HTMLDetailsElement>('.cv-menu[open]').forEach((menu) => closeMenu(menu, true));
  });
  document.addEventListener('click', (event) => {
    const current = event.target instanceof Element ? event.target.closest('.cv-menu') : null;
    document.querySelectorAll<HTMLDetailsElement>('.cv-menu[open]').forEach((menu) => {
      if (menu !== current) closeMenu(menu);
    });
  });
}
