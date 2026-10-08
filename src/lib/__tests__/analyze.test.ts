import { describe, expect, it } from 'vitest';
import ordersJson from '../../samples/orders.json?raw';
import revenueText from '../../samples/revenue.txt?raw';
import { analyzePlan } from '../analyze';
import { parsePlan } from '../parse';
import type { AnalyzedPlan, RawPlan } from '../types';

const byName = (plan: AnalyzedPlan, name: string) => plan.nodes.filter((n) => n.name === name);
const total = (plan: AnalyzedPlan) => plan.nodes.reduce((sum, n) => sum + (n.exclusiveDuration ?? 0), 0);

describe('analyzePlan', () => {
  it('splits the execution time across nodes for a simple plan', () => {
    const plan = analyzePlan(parsePlan(ordersJson));

    expect(plan.root.name).toBe('Limit');
    expect(plan.hasTiming).toBe(true);
    expect(plan.hasBuffers).toBe(true);
    expect(plan.stats.executionTime).toBe(726.8);
    expect(plan.stats.planningTime).toBe(26.171);
    expect(total(plan)).toBeCloseTo(plan.root.inclusiveDuration!, 6);

    const [hashAggregate] = byName(plan, 'HashAggregate');
    expect(hashAggregate.exclusiveDuration).toBeCloseTo(724.417 - 354.285, 6);
    expect(hashAggregate.tags).toContain('slowest');
    expect(plan.stats.maxDuration).toBe(hashAggregate.exclusiveDuration);
  });

  it('attributes CTEs and InitPlans to the nodes that run them, and accounts for parallel workers', () => {
    const plan = analyzePlan(parsePlan(revenueText));

    // every millisecond is attributed to exactly one node
    expect(total(plan)).toBeCloseTo(plan.root.inclusiveDuration!, 6);

    const [parallelScan] = byName(plan, 'Parallel Seq Scan');
    expect(parallelScan.processes).toBe(3);
    expect(parallelScan.inclusiveDuration).toBeCloseTo(12.25, 6);
    expect(parallelScan.totalRows).toBe(20117 * 3);

    const [gather] = byName(plan, 'Gather');
    expect(gather.processes).toBe(1);
    expect(gather.exclusiveDuration).toBeCloseTo(25.861 - 20.905, 6);

    // the CTE Scan's time includes running the CTE and the InitPlan referenced by its filter
    const [cteScan] = byName(plan, 'CTE Scan');
    expect(cteScan.exclusiveDuration).toBeCloseTo(92.418 - 31.552 - 25.873, 6);
    expect(cteScan.buffers!.exclusive.sharedHit).toBe(0);
    expect(cteScan.buffers!.exclusive.sharedRead).toBe(0);
    expect(cteScan.tags).toContain('slowest');

    // ...but not the time of the Limit the InitPlans hang off of
    expect(plan.root.exclusiveDuration).toBeCloseTo(128.889 - 128.885, 6);
    expect(plan.root.subplanName).toBeUndefined();
    expect(plan.root.children.map((c) => c.subplanName)).toEqual(['CTE recent_orders', 'InitPlan 2 (returns $1)', undefined]);

    // InitPlan costs, unlike their time, are included in the cost of the node they hang off of
    // (and a Limit costs less than its input, since it stops reading early)
    expect(6998.95 - 1771.38 - 2457.7 - 2769.97).toBeLessThan(0);
    expect(plan.root.exclusiveCost).toBe(0);

    const [hash] = byName(plan, 'Hash');
    expect(hash.buffers!.exclusive).toMatchObject({ sharedHit: 0, sharedRead: 0, tempWritten: 58 });
    expect(hash.tags).toContain('spills to disk');

    expect(plan.stats.buffers).toMatchObject({ sharedHit: 208, sharedRead: 3520, tempRead: 116, tempWritten: 116 });
    expect(plan.stats.planningBuffers).toMatchObject({ sharedHit: 48 });
  });

  it('computes planner estimate misses, treating zero rows as one', () => {
    const plan = analyzePlan({
      Plan: {
        'Node Type': 'Nested Loop',
        'Plan Rows': 1,
        'Actual Rows': 500,
        'Actual Loops': 1,
        Plans: [
          { 'Node Type': 'Seq Scan', 'Plan Rows': 1000, 'Actual Rows': 0, 'Actual Loops': 1 },
          { 'Node Type': 'Index Scan', 'Plan Rows': 5, 'Actual Rows': 0, 'Actual Loops': 0 },
        ],
      },
    });

    const [loop, scan, neverExecuted] = plan.nodes;
    expect(loop.estimate).toEqual({ factor: 500, direction: 'under' });
    expect(loop.tags).toContain('bad estimate');
    expect(scan.estimate).toEqual({ factor: 1000, direction: 'over' });
    expect(neverExecuted.executed).toBe(false);
    expect(neverExecuted.estimate).toBeUndefined();
    expect(plan.hasTiming).toBe(false);
  });

  it('handles plans without ANALYZE', () => {
    const raw: RawPlan = {
      Plan: {
        'Node Type': 'Hash Join',
        'Total Cost': 100,
        Plans: [
          { 'Node Type': 'Seq Scan', 'Total Cost': 40 },
          { 'Node Type': 'Hash', 'Total Cost': 30, Plans: [{ 'Node Type': 'Seq Scan', 'Total Cost': 30 }] },
        ],
      },
    };
    const plan = analyzePlan(raw);
    expect(plan.hasTiming).toBe(false);
    expect(plan.stats.executionTime).toBeUndefined();
    expect(plan.nodes.map((n) => n.exclusiveCost)).toEqual([30, 40, 0, 30]);
    expect(plan.nodes.map((n) => n.tags)).toEqual([[], ['costliest'], [], []]);
  });

  it('names nodes the way text-format EXPLAIN does', () => {
    const plan = analyzePlan({
      Plan: {
        'Node Type': 'Aggregate',
        Strategy: 'Hashed',
        'Partial Mode': 'Finalize',
        Plans: [
          { 'Node Type': 'SetOp', Strategy: 'Sorted', Command: 'Intersect' },
          { 'Node Type': 'ModifyTable', Operation: 'Update' },
          { 'Node Type': 'Index Only Scan', 'Scan Direction': 'Backward', 'Parallel Aware': true },
        ],
      },
    });
    expect(plan.nodes.map((n) => n.name)).toEqual([
      'Finalize HashAggregate',
      'SetOp Intersect',
      'Update',
      'Parallel Index Only Scan Backward',
    ]);
  });
});
