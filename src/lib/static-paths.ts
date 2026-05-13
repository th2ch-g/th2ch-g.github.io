import { collectTags, getByLang, localeSlug } from './content';
import type { Lang } from '@/i18n/ui';

// Each helper here returns the exact `{ params, props }[]` shape that
// `getStaticPaths` expects. Detail pages and tag pages can't share a
// `getStaticPaths` import point because Astro evaluates each page's
// `getStaticPaths` independently and cannot read parent context — but they
// CAN share the body of that function, which is what these helpers expose.
//
// Draft policy: post detail / post tag pages exclude drafts from production
// but keep them buildable in `npm run dev` so authors can preview.

export async function buildPostsDetailPaths(lang: Lang) {
  const posts = (await getByLang('posts', lang)).filter(
    (p) => !p.data.draft || import.meta.env.DEV,
  );
  return posts.map((post) => ({
    params: { slug: localeSlug(post.id) },
    props: { post },
  }));
}

// Shared by `pages/tags/[tag].astro` and the EN twin. Collects the
// alphabetized list of post tags (drafts visible only in dev).
export async function buildTagPaths(lang: Lang) {
  const posts = (await getByLang('posts', lang)).filter(
    (p) => !p.data.draft || import.meta.env.DEV,
  );
  return collectTags(posts).map((tag) => ({
    params: { tag },
    props: { tag },
  }));
}
