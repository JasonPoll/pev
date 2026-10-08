import { describe, expect, it } from 'vitest';
import ordersJson from '../../samples/orders.json?raw';
import revenueText from '../../samples/revenue.txt?raw';
import { analyzePlan } from '../analyze';
import { buildFlame } from '../flame';
import { findInsights } from '../insights';
import { layoutTree } from '../layout';
import { parsePlan } from '../parse';

const revenue = () => analyzePlan(parsePlan(revenueText));

describe('layoutTree', () => {
  it('places children below their parent without overlapping', () => {
    const plan = revenue();
    const layout = layoutTree(plan.root, { nodeWidth: 200, nodeHeight: 76, hGap: 20, vGap: 40 });

    expect(layout.nodes).toHaveLength(plan.nodes.length);
    expect(layout.edges).toHaveLength(plan.nodes.length - 1);
    expect(layout.edges.filter((e) => e.subplan).map((e) => e.child.node.subplanName)).toEqual([
      'CTE recent_orders',
      'InitPlan 2 (returns $1)',
    ]);

    for (const { parent, child } of layout.edges) expect(child.y).toBeGreaterThan(parent.y);

    const byRow = Map.groupBy(layout.nodes, (n) => n.y);
    for (const row of byRow.values()) {
      const xs = row.map((n) => n.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(220);
    }
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...layout.nodes.map((n) => n.x + 200))).toBeLessThanOrEqual(layout.width);
  });
});

describe('buildFlame', () => {
  it('moves CTEs and InitPlans under the node that ran them', () => {
    const plan = revenue();
    const flame = buildFlame(plan);
    const block = (name: string) => flame.blocks.find((b) => b.node.name === name)!;

    expect(flame.unit).toBe('time');
    expect(block('Limit')).toMatchObject({ x: 0, width: 1, depth: 0 });

    const cteScan = block('CTE Scan');
    const cte = flame.blocks.find((b) => b.node.subplanName === 'CTE recent_orders')!;
    const initPlan = flame.blocks.find((b) => b.node.subplanName === 'InitPlan 2 (returns $1)')!;
    expect(cte).toMatchObject({ depth: cteScan.depth + 1, moved: true });
    expect(initPlan).toMatchObject({ depth: cteScan.depth + 1, moved: true });
    expect(initPlan.x).toBeCloseTo(cte.x + cte.width, 9);
    expect(cteScan.width).toBeCloseTo(92.418 / 128.889, 9);

    // children never stick out of their parent
    for (const b of flame.blocks) {
      const children = flame.blocks.filter((c) => c.depth === b.depth + 1 && c.x >= b.x - 1e-9 && c.x < b.x + b.width - 1e-9);
      const end = Math.max(b.x, ...children.map((c) => c.x + c.width));
      expect(end).toBeLessThanOrEqual(b.x + b.width + 1e-9);
    }
  });

  it('falls back to cost for plans without ANALYZE', () => {
    const flame = buildFlame(
      analyzePlan({ Plan: { 'Node Type': 'Hash Join', 'Total Cost': 100, Plans: [{ 'Node Type': 'Seq Scan', 'Total Cost': 40 }] } }),
    );
    expect(flame.unit).toBe('cost');
    expect(flame.blocks[1].width).toBeCloseTo(0.4, 9);
  });
});

describe('findInsights', () => {
  it('explains what is slow about the sample parallel plan', () => {
    const plan = revenue();
    const findings = findInsights(plan);
    const cteScan = plan.nodes.find((n) => n.name === 'CTE Scan')!;
    const hash = plan.nodes.find((n) => n.name === 'Hash')!;

    expect(findings.map((f) => f.title)).toEqual([
      'CTE Scan on recent_orders throws away 59% of its rows',
      'Hash spills to disk',
      'Cold cache: 94% of blocks read from disk',
      'public.orders is scanned 2 times',
    ]);
    expect(findings[0]).toMatchObject({ severity: 'high', nodeIds: [cteScan.id] });
    expect(findings[0].detail).toContain('35,432 of 60,350 rows fail the filter');
    expect(findings[1]).toMatchObject({ nodeIds: [hash.id] });
    expect(findings[1].detail).toBe(
      'Batches grew from 1 to 2 under work_mem = 1MB, writing 464 kB to temp. Around 2MB of work_mem keeps the hash in memory.',
    );
  });

  it('finds nothing alarming in a fast, well-estimated plan', () => {
    expect(findInsights(analyzePlan(parsePlan(ordersJson))).map((f) => f.id)).toEqual(['cold-cache']);
  });
});
