import { copyToClipboard } from './clipboard';
import { COPY_ICON, CHECK_ICON } from './copy-icons';

export function setupCodeCopy(): void {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  const label = main.dataset.copyLabel ?? 'Copy';
  const copiedLabel = main.dataset.copiedLabel ?? 'Copied';
  const failedLabel = main.dataset.copyFailedLabel ?? 'Copy failed';
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
      const ok = await copyToClipboard(code.innerText);
      window.clearTimeout(feedbackTimer);
      button.innerHTML = ok ? CHECK_ICON : COPY_ICON;
      button.setAttribute('aria-label', ok ? copiedLabel : failedLabel);
      button.classList.toggle('is-copied', ok);
      button.classList.toggle('is-failed', !ok);
      feedbackTimer = window.setTimeout(() => {
        button.innerHTML = COPY_ICON;
        button.setAttribute('aria-label', label);
        button.classList.remove('is-copied', 'is-failed');
      }, 1600);
    });
    pre.appendChild(button);
  });
}
