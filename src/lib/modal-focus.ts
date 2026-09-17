const focusableSelector = 'a[href], button, input, select, textarea, [tabindex]';

export function hasOpenModal(): boolean {
  return !!document.querySelector('dialog[open], [aria-modal="true"]:not([hidden]):not([aria-hidden="true"])');
}

/** Isolate a custom modal until its returned cleanup function is called. */
export function containModalFocus(panel: HTMLElement, backdrop?: HTMLElement): () => void {
  const outside = new Map<HTMLElement, boolean>();
  let branch = panel;
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || sibling === backdrop) continue;
      outside.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    if (branch.parentElement === document.body) break;
    branch = branch.parentElement;
  }

  const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled')
      && !element.closest('[inert]') && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden');

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const elements = focusable();
    if (!elements.length) return;
    event.preventDefault();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
    elements[next].focus();
  };
  const onFocus = (event: FocusEvent) => {
    if (event.target instanceof Node && !panel.contains(event.target)) focusable()[0]?.focus();
  };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('focusin', onFocus);
  return () => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('focusin', onFocus);
    outside.forEach((inert, element) => { element.inert = inert; });
  };
}
