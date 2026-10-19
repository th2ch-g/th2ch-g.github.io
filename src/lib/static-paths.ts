import { getPosts, localeSlug } from './content';

// Shared paths must include posts available in either locale.
export async function buildPostsDetailPaths() {
  const posts = await getPosts();
  return posts.map((post) => ({
    params: { slug: localeSlug(post.id) },
    props: { post },
  }));
}
