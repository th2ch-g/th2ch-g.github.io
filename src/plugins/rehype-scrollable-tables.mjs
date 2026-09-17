import { visit } from 'unist-util-visit';

/** Make horizontally scrolling Markdown tables reachable by keyboard. */
export function rehypeScrollableTables() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'table') node.properties.tabIndex = 0;
    });
  };
}
