import { getByLang, localeSlug } from './content';
import type { Lang } from '@/i18n/ui';

// Both languages use the same post paths.
export async function buildPostsDetailPaths(lang: Lang) {
  const posts = await getByLang('posts', lang);
  return posts.map((post) => ({
    params: { slug: localeSlug(post.id) },
    props: { post },
  }));
}
