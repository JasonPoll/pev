import type { AnalyzedNode } from './types';

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  hGap: number;
  vGap: number;
}

export interface PositionedNode {
  node: AnalyzedNode;
  x: number;
  y: number;
}

export interface LayoutEdge {
  parent: PositionedNode;
  child: PositionedNode;
  // InitPlan/SubPlan links hang a sub-query off a node rather than feed it rows
  subplan: boolean;
}

export interface TreeLayout {
  nodes: PositionedNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// A simple top-down tree layout: every subtree gets a slot as wide as its widest level, and parents are
// centered over their first and last child.
export function layoutTree(root: AnalyzedNode, options: LayoutOptions): TreeLayout {
  const { nodeWidth, nodeHeight, hGap, vGap } = options;
  const widths = new Map<AnalyzedNode, number>();

  const measure = (node: AnalyzedNode): number => {
    const childrenWidth = node.children.reduce((sum, c) => sum + measure(c), 0) + hGap * Math.max(0, node.children.length - 1);
    const width = Math.max(nodeWidth, childrenWidth);
    widths.set(node, width);
    return width;
  };
  measure(root);

  const nodes: PositionedNode[] = [];
  const edges: LayoutEdge[] = [];

  const place = (node: AnalyzedNode, left: number, depth: number): PositionedNode => {
    const width = widths.get(node)!;
    const y = depth * (nodeHeight + vGap);
    const childrenWidth =
      node.children.reduce((sum, c) => sum + widths.get(c)!, 0) + hGap * Math.max(0, node.children.length - 1);

    let childLeft = left + (width - childrenWidth) / 2;
    const children = node.children.map((child) => {
      const positioned = place(child, childLeft, depth + 1);
      childLeft += widths.get(child)! + hGap;
      return positioned;
    });

    const x = children.length
      ? (children[0].x + children[children.length - 1].x) / 2
      : left + (width - nodeWidth) / 2;
    const positioned = { node, x, y };
    nodes.push(positioned);

    for (const child of children) {
      const relationship = child.node.raw['Parent Relationship'];
      edges.push({ parent: positioned, child, subplan: relationship === 'InitPlan' || relationship === 'SubPlan' });
    }
    return positioned;
  };
  place(root, 0, 0);

  const maxDepth = Math.max(...nodes.map((n) => n.y));
  return { nodes, edges, width: widths.get(root)!, height: maxDepth + nodeHeight };
}
