import { onReady } from './dom-ready';

export function wireMermaid(): void {
  onReady(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('pre.mermaid')];
    if (!nodes.length) return;
    const sources = nodes.map((node) => node.textContent ?? '');
    const themeFor = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';

    void import('mermaid').then(({ default: mermaid }) => {
      let rendering = false;
      let renderedTheme: string | undefined;
      const render = async () => {
        if (rendering) return;
        rendering = true;
        try {
          // Coalesce theme changes while Mermaid's asynchronous renderer runs.
          while (renderedTheme !== themeFor()) {
            const theme = themeFor();
            mermaid.initialize({ startOnLoad: false, theme });
            nodes.forEach((node, index) => {
              node.removeAttribute('data-processed');
              node.textContent = sources[index];
            });
            await mermaid.run({ nodes });
            renderedTheme = theme;
          }
        } finally {
          rendering = false;
        }
      };
      const requestRender = () => {
        void render().catch((error) => console.warn('Diagram rendering failed', error));
      };
      const observer = new MutationObserver(requestRender);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      requestRender();
    }).catch((error) => console.warn('Diagram loading failed', error));
  });
}
