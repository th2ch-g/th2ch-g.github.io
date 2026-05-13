import type { APIRoute } from 'astro';
import { requireSite } from '@/lib/site';

// AI training / retrieval crawler opt-out. Disallowed UAs are listed
// inline because the policy is site-wide and the list itself isn't
// identity — forks can adopt this verbatim or strip it. The
// `Sitemap:` URLs are the only identity-bearing part and are derived
// from `astro.config.mjs#site` (which itself reads from profile.yaml),
// so a fork only has to edit `profile.yaml` to retarget them.
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

export const GET: APIRoute = async (context) => {
  const site = requireSite(context).toString().replace(/\/$/, '');
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
    'Allow: /\n' +
    '\n' +
    `Sitemap: ${site}/sitemap-index.xml\n` +
    `Sitemap: ${site}/sitemap-images.xml\n`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
