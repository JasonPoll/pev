import type { AnalyzedNode, AnalyzedPlan } from './types';

export interface FlameBlock {
  node: AnalyzedNode;
  // horizontal position and size as fractions of the root's width
  x: number;
  width: number;
  depth: number;
  value: number;
  // the block sits under the node that ran it rather than its parent in the plan (CTEs, InitPlans)
  moved: boolean;
}

export interface Flame {
  blocks: FlameBlock[];
  depth: number;
  // what the widths measure
  unit: 'time' | 'cost';
}

// An icicle chart of inclusive time (or cost, for plans without ANALYZE). CTEs and InitPlans are moved under
// the node that actually ran them, so that each block's children add up to (at most) the block itself.
export function buildFlame(plan: AnalyzedPlan): Flame {
  const unit = plan.hasTiming ? 'time' : 'cost';
  const valueOf = (n: AnalyzedNode) =>
    unit === 'time' ? (n.inclusiveDuration ?? 0) : ((n.raw['Total Cost'] as number | undefined) ?? 0);

  const movedHere = new Map<number, AnalyzedNode[]>();
  for (const node of plan.nodes) {
    if (node.payerId !== undefined && node.payerId !== node.parentId) {
      movedHere.set(node.payerId, [...(movedHere.get(node.payerId) ?? []), node]);
    }
  }

  const childrenOf = (node: AnalyzedNode) => [
    ...node.children.filter((c) => c.payerId === undefined || c.payerId === node.id),
    ...(movedHere.get(node.id) ?? []),
  ];

  const rootValue = valueOf(plan.root) || 1;
  const blocks: FlameBlock[] = [];

  const visit = (node: AnalyzedNode, x: number, width: number, depth: number, moved: boolean) => {
    blocks.push({ node, x, width, depth, value: valueOf(node), moved });

    const children = childrenOf(node);
    const total = children.reduce((sum, c) => sum + valueOf(c), 0);
    // children can't be wider than their parent (rounding, or a CTE shared by several scans)
    const scale = total / rootValue > width ? width / (total / rootValue) : 1;

    let childX = x;
    for (const child of children) {
      const childWidth = (valueOf(child) / rootValue) * scale;
      visit(child, childX, childWidth, depth + 1, child.parentId !== node.id);
      childX += childWidth;
    }
  };
  visit(plan.root, 0, 1, 0, false);

  return { blocks, depth: Math.max(...blocks.map((b) => b.depth)) + 1, unit };
}
