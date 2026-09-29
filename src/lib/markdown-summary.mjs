import { createMarkdownProcessor } from '@astrojs/markdown-remark';

/**
 * @typedef {object} MarkdownNode
 * @property {string} type
 * @property {number} [depth]
 * @property {string} [value]
 * @property {string} [alt]
 * @property {string} [url]
 * @property {string} [identifier]
 * @property {MarkdownNode[]} [children]
 */

/** @param {MarkdownNode} node @returns {string} */
function plainText(node) {
  if (node.type === 'html') return '';
  if (node.type === 'break') return ' ';
  return node.children?.map(plainText).join('') ?? node.alt ?? node.value ?? '';
}

/** @param {string} body */
export async function summarizeMarkdown(body) {
  /** @type {{title: string, description?: string, links: string[], standaloneLink?: string}} */
  const summary = {
    title: '',
    description: undefined,
    links: [],
    standaloneLink: undefined,
  };
  /** @type {import('@astrojs/markdown-remark').RemarkPlugin} */
  const collect = () => (tree) => {
    const root = /** @type {MarkdownNode} */ (tree);
    const children = root.children ?? [];
    const titleIndex = children.findIndex((node) => node.type === 'heading' && node.depth === 1);
    if (titleIndex !== -1) {
      summary.title = plainText(children[titleIndex]).replace(/\s+/g, ' ').trim();
      const introduction = children.slice(titleIndex + 1).find((node) => node.type !== 'html');
      if (introduction?.type === 'paragraph') {
        summary.description = plainText(introduction).replace(/\s+/g, ' ').trim() || undefined;
      }
    }
    const definitions = new Map(children.filter((node) => node.type === 'definition')
      .map((node) => [node.identifier, node.url]));
    /** @param {MarkdownNode} node */
    const collectLinks = (node) => {
      const url = node.type === 'link' ? node.url
        : node.type === 'linkReference' ? definitions.get(node.identifier) : undefined;
      if (url) summary.links.push(url);
      node.children?.forEach(collectLinks);
    };
    collectLinks(root);
    summary.links = [...new Set(summary.links)];
    const blocks = children.filter((node) => node.type !== 'definition');
    const paragraph = blocks.length === 1 && blocks[0].type === 'paragraph' ? blocks[0] : undefined;
    const link = paragraph?.children?.length === 1 ? paragraph.children[0] : undefined;
    summary.standaloneLink = link?.type === 'link' ? link.url
      : link?.type === 'linkReference' ? definitions.get(link.identifier) : undefined;
  };
  const processor = await createMarkdownProcessor({
    syntaxHighlight: false,
    smartypants: false,
    remarkPlugins: [collect],
  });
  await processor.render(body);
  return summary;
}
