// Prefer rich content when supplied, then plain text and a legacy copy
// fallback. Every caller receives a boolean for its own feedback UI.
export async function copyToClipboard(text: string, html?: string): Promise<boolean> {
  if (html !== undefined && 'ClipboardItem' in window && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    } catch {
      // Preserve a plain-text copy when rich clipboard writes are rejected.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // execCommand path — works without HTTPS / Permissions API.
  }
  const previouslyFocused = document.activeElement;
  const ta = document.createElement('textarea');
  try {
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // `execCommand` is marked `@deprecated` in lib.dom.d.ts but remains
    // the only synchronous-write copy path for non-secure contexts where
    // `navigator.clipboard.writeText` rejects (e.g. non-localhost HTTP,
    // strict Firefox permission profiles). Cast through a structural
    // type that omits the deprecation marker so `astro check` stays
    // clean without disabling the suggestion globally.
    const legacy = document as { execCommand(cmd: string): boolean };
    return legacy.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
  }
}
