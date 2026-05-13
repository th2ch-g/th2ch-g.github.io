// Shared HTML escape helpers for remark plugins that emit raw HTML nodes.
// Five-entity escape (`&<>"'`) is safe both as text content and as an
// attribute value, so callers can use `escapeHtml` for either site.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
