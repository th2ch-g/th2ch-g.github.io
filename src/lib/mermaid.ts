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
            const styles = getComputedStyle(document.documentElement);
            const color = (name: string) => styles.getPropertyValue(`--color-${name}`).trim();
            mermaid.initialize({
              startOnLoad: false,
              theme: theme === 'dark' ? 'base' : 'default',
              themeVariables: theme === 'dark' ? {
                darkMode: true,
                background: color('bg'),
                primaryColor: color('card'),
                primaryTextColor: color('fg'),
                primaryBorderColor: color('border-strong'),
                secondaryColor: color('button'),
                secondaryTextColor: color('fg'),
                secondaryBorderColor: color('border-strong'),
                tertiaryColor: color('inset'),
                tertiaryTextColor: color('fg'),
                tertiaryBorderColor: color('border-strong'),
                lineColor: color('muted'),
                textColor: color('fg'),
                edgeLabelBackground: color('bg'),
                noteBkgColor: color('overlay'),
                noteTextColor: color('fg'),
                noteBorderColor: color('border-strong'),
              } : {},
            });
            nodes.forEach((node, index) => {
              node.removeAttribute('data-processed');
              delete node.dataset.mermaidTheme;
              node.textContent = sources[index];
            });
            await mermaid.run({ nodes });
            nodes.forEach((node) => { node.dataset.mermaidTheme = theme; });
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
