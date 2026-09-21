import { onReady } from './dom-ready';

export function wireTweetEmbeds(): void {
  onReady(() => {
    const embeds = document.querySelectorAll<HTMLElement>('.tweet-embed');
    if (!embeds.length) return;

    let requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      const script = document.createElement('script');
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      document.head.append(script);
    };

    // The source link remains usable with JavaScript disabled or blocked.
    if (!('IntersectionObserver' in window)) {
      load();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '300px 0px' });
    embeds.forEach((embed) => observer.observe(embed));
  });
}
