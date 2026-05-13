// Two-stage clipboard write: Async Clipboard API first (modern, secure
// contexts), then a `document.execCommand('copy')` fallback for older
// browsers and non-secure contexts where `navigator.clipboard` rejects.
// Returns false only if both paths fail, so callers can surface a
// visible "copy failed" state instead of silently doing nothing.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // execCommand path — works without HTTPS / Permissions API.
  }
  try {
    const ta = document.createElement('textarea');
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
    const ok = legacy.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
