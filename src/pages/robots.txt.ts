import type { APIRoute } from 'astro';

// AI training and retrieval crawler opt-out, applied site-wide.
const DISALLOWED_AI_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'anthropic-ai',
  'ClaudeBot',
  'Claude-Web',
  'Claude-SearchBot',
  'Google-Extended',
  'GoogleOther',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'Bytespider',
  'Applebot-Extended',
  'Amazonbot',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  'FacebookBot',
  'Diffbot',
  'ImagesiftBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Omgili',
  'Omgilibot',
  'DuckAssistBot',
  'FriendlyCrawler',
  'ICC-Crawler',
  'AI2Bot',
  'AwarioRssBot',
  'AwarioSmartBot',
  'Timpibot',
  'PetalBot',
  'SemrushBot-OCOB',
  'VelenPublicWebCrawler',
  'img2dataset',
  'Scrapy',
];

export const GET: APIRoute = async () => {
  const body =
    '# Goal: opt out of AI training and AI-assistant retrieval crawlers\n' +
    '# while keeping the site discoverable through traditional web search.\n' +
    '#\n' +
    '# Honored only by well-behaved bots. Malicious scrapers ignore this file.\n' +
    '# See also `/ai.txt`, `/.well-known/tdmrep.json`, and the\n' +
    '# `<meta name="robots" content="noai, noimageai">` tag in every page.\n' +
    '\n' +
    '# --- AI training & retrieval crawlers: disallowed ---\n' +
    '\n' +
    DISALLOWED_AI_BOTS.map((ua) => `User-agent: ${ua}\nDisallow: /`).join('\n\n') +
    '\n\n' +
    '# --- Everything else (Googlebot, Bingbot, DuckDuckBot, etc.): allowed ---\n' +
    '\n' +
    'User-agent: *\n' +
    'Allow: /\n';

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
