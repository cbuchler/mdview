/** Maximum child-edge depth, including structural and inline nodes; root is 0. */
export const MAX_MARKDOWN_DEPTH = 128;

export function markdownDepthError(): Error {
  return new Error(`Markdown nesting exceeds the supported depth limit (${MAX_MARKDOWN_DEPTH}).`);
}

export function validateMarkdownDepth(root: { children?: unknown[] }): void {
  const stack: Array<{ node: { children?: unknown[] }; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_MARKDOWN_DEPTH) {
      throw markdownDepthError();
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child !== null && typeof child === 'object') {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }
  }
}
