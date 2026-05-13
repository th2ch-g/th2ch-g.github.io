/// <reference path="../.astro/types.d.ts" />

// Cross-script flags hung off `window` for idempotent setup. These are
// document/window-level guards used by inline scripts that re-execute
// on view transitions (e.g. Search.astro's data-astro-rerun script).
declare global {
  interface Window {
    __th2chSearchKeydownBound?: boolean;
  }
  // Per-component cleanup hook: scripts that attach window-level listeners
  // hang their teardown function on the component root so the next
  // astro:before-swap can call it before DOM replacement.
  interface HTMLElement {
    __cleanup?: () => void;
  }
}
export {};
