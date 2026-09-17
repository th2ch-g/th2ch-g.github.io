import { copyToClipboard } from './clipboard';
import { COPY_ICON, CHECK_ICON } from './copy-icons';

export function setupCodeCopy(): void {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  const label = main.dataset.copyLabel ?? 'Copy';
  const copiedLabel = main.dataset.copiedLabel ?? 'Copied';
  main.querySelectorAll('pre:not(.mermaid)').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-code')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.innerHTML = COPY_ICON;
    button.setAttribute('aria-label', label);
    let feedbackTimer: number | undefined;
    button.addEventListener('click', async () => {
      if (!await copyToClipboard(code.innerText)) return;
      window.clearTimeout(feedbackTimer);
      button.innerHTML = CHECK_ICON;
      button.setAttribute('aria-label', copiedLabel);
      button.classList.add('is-copied');
      feedbackTimer = window.setTimeout(() => {
        button.innerHTML = COPY_ICON;
        button.setAttribute('aria-label', label);
        button.classList.remove('is-copied');
      }, 1600);
    });
    pre.appendChild(button);
  });
}
