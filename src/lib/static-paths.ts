import { getByLang, localeSlug } from './content';
import type { Lang } from '@/i18n/ui';

// Posts are shared, so JA and EN route wrappers receive the same path set.
// Each wrapper exports its own getStaticPaths and shares this helper body.
// Drafts are buildable only in development so authors can preview them.
export async function buildPostsDetailPaths(lang: Lang) {
  const posts = (await getByLang('posts', lang)).filter(
    (p) => !p.data.draft || import.meta.env.DEV,
  );
  return posts.map((post) => ({
    params: { slug: localeSlug(post.id) },
    props: { post },
  }));
}
