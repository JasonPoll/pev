import { describe, expect, it } from 'vitest';
import revenueText from '../../samples/revenue.txt?raw';
import { parsePlan } from '../parse';
import { parseNodeLine, parseTextPlan } from '../textParser';
import type { RawNode } from '../types';

const plans = (node: RawNode) => node.Plans ?? [];

describe('parseTextPlan', () => {
  it('parses the psql output of a plan with a CTE, an InitPlan and parallel workers', () => {
    const plan = parsePlan(revenueText);
    const limit = plan.Plan;

    expect(limit['Node Type']).toBe('Limit');
    expect(limit['Total Cost']).toBe(6998.95);
    expect(limit['Actual Total Time']).toBe(128.889);
    expect(limit['Shared Read Blocks']).toBe(3520);
    expect(limit['Temp Written Blocks']).toBe(116);

    const [cte, initPlan, sort] = plans(limit);
    expect(cte).toMatchObject({
      'Node Type': 'Seq Scan',
      'Parent Relationship': 'InitPlan',
      'Subplan Name': 'CTE recent_orders',
      Schema: 'public',
      'Relation Name': 'orders',
      Alias: 'o',
      Filter: "(o.orderdate >= '2024-01-01'::date)",
      'Rows Removed by Filter': 1650,
      Output: ['o.orderid', 'o.customerid', 'o.totalamount'],
    });
    expect(initPlan).toMatchObject({
      'Node Type': 'Aggregate',
      Strategy: 'Plain',
      'Partial Mode': 'Finalize',
      'Parent Relationship': 'InitPlan',
      'Subplan Name': 'InitPlan 2 (returns $1)',
    });

    const gather = plans(initPlan)[0];
    expect(gather).toMatchObject({ 'Node Type': 'Gather', 'Workers Planned': 2, 'Workers Launched': 2 });

    const partialAgg = plans(gather)[0];
    expect(partialAgg['Shared Hit Blocks']).toBe(164);
    expect(partialAgg.Workers).toEqual([
      { 'Worker Number': 0, 'Actual Startup Time': 20.511, 'Actual Total Time': 20.512, 'Actual Rows': 1, 'Actual Loops': 1, 'Shared Hit Blocks': 54, 'Shared Read Blocks': 478 },
      { 'Worker Number': 1, 'Actual Startup Time': 20.873, 'Actual Total Time': 20.874, 'Actual Rows': 1, 'Actual Loops': 1, 'Shared Hit Blocks': 55, 'Shared Read Blocks': 489 },
    ]);

    const parallelScan = plans(partialAgg)[0];
    expect(parallelScan).toMatchObject({
      'Node Type': 'Seq Scan',
      'Parallel Aware': true,
      'Relation Name': 'orders',
      'Actual Loops': 3,
      'Shared Hit Blocks': 164,
    });

    expect(sort).toMatchObject({
      'Sort Key': ['(sum(r.totalamount)) DESC'],
      'Sort Method': 'top-N heapsort',
      'Sort Space Used': 26,
      'Sort Space Type': 'Memory',
    });

    const hashAgg = plans(sort)[0];
    expect(hashAgg).toMatchObject({ Strategy: 'Hashed', 'Group Key': ['c.state'], 'HashAgg Batches': 1, 'Peak Memory Usage': 32 });

    const hashJoin = plans(hashAgg)[0];
    expect(hashJoin).toMatchObject({ 'Node Type': 'Hash Join', 'Join Type': 'Inner', 'Inner Unique': true, 'Hash Cond': '(r.customerid = c.customerid)' });

    const [cteScan, hash] = plans(hashJoin);
    expect(cteScan).toMatchObject({ 'Node Type': 'CTE Scan', 'CTE Name': 'recent_orders', Alias: 'r', Filter: '(r.totalamount > $1)' });
    expect(hash).toMatchObject({
      'Hash Buckets': 32768,
      'Original Hash Buckets': 16384,
      'Hash Batches': 2,
      'Original Hash Batches': 1,
      'Peak Memory Usage': 769,
      'Temp Written Blocks': 58,
    });
    expect(plans(hash)[0]).toMatchObject({ 'Relation Name': 'customers', Alias: 'c' });

    expect(plan['Planning Time']).toBe(0.412);
    expect(plan['Execution Time']).toBe(129.507);
    expect(plan.Planning).toEqual({ 'Shared Hit Blocks': 48 });
    expect(plan.Settings).toEqual({ work_mem: '1MB', random_page_cost: '1.1' });
  });

  it('parses node names into the JSON node type and its properties', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['Hash Left Join', { 'Node Type': 'Hash Join', 'Join Type': 'Left' }],
      ['Merge Right Anti Join', { 'Node Type': 'Merge Join', 'Join Type': 'Right Anti' }],
      ['Nested Loop', { 'Node Type': 'Nested Loop', 'Join Type': 'Inner' }],
      ['Nested Loop Semi Join', { 'Node Type': 'Nested Loop', 'Join Type': 'Semi' }],
      ['Index Scan Backward using orders_pkey on orders o', { 'Node Type': 'Index Scan', 'Scan Direction': 'Backward', 'Index Name': 'orders_pkey', 'Relation Name': 'orders', Alias: 'o' }],
      ['Index Only Scan using idx on public.t', { 'Node Type': 'Index Only Scan', Schema: 'public', 'Relation Name': 't', Alias: 't' }],
      ['Bitmap Index Scan on "Weird Index"', { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'Weird Index' }],
      ['Partial HashAggregate', { 'Node Type': 'Aggregate', Strategy: 'Hashed', 'Partial Mode': 'Partial' }],
      ['GroupAggregate', { 'Node Type': 'Aggregate', Strategy: 'Sorted', 'Partial Mode': 'Simple' }],
      ['HashSetOp Except All', { 'Node Type': 'SetOp', Strategy: 'Hashed', Command: 'Except All' }],
      ['Insert on orders', { 'Node Type': 'ModifyTable', Operation: 'Insert', 'Relation Name': 'orders' }],
      ['Parallel Index Scan using idx on t', { 'Node Type': 'Index Scan', 'Parallel Aware': true }],
      ['Async Foreign Scan on remote_t', { 'Node Type': 'Foreign Scan', 'Async Capable': true, 'Relation Name': 'remote_t' }],
      ['Function Scan on generate_series g', { 'Node Type': 'Function Scan', 'Function Name': 'generate_series', Alias: 'g' }],
      ['Values Scan on "*VALUES*"', { 'Node Type': 'Values Scan', Alias: '*VALUES*' }],
      ['Subquery Scan on sub', { 'Node Type': 'Subquery Scan', Alias: 'sub' }],
      ['Gather Merge', { 'Node Type': 'Gather Merge' }],
      ['Memoize', { 'Node Type': 'Memoize' }],
    ];
    for (const [name, expected] of cases) {
      expect(parseNodeLine(`${name}  (cost=0.00..1.00 rows=1 width=4)`), name).toMatchObject(expected);
    }
  });

  it('parses the different flavors of the node line', () => {
    expect(parseNodeLine('Seq Scan on t  (cost=0.00..35.50 rows=2550 width=4) (never executed)')).toMatchObject({
      'Total Cost': 35.5,
      'Actual Rows': 0,
      'Actual Loops': 0,
    });
    expect(parseNodeLine('Seq Scan on t  (cost=0.00..35.50 rows=2550 width=4) (actual rows=10 loops=2)')).toMatchObject({
      'Actual Rows': 10,
      'Actual Loops': 2,
    });
    expect(parseNodeLine('Seq Scan on t  (actual time=0.010..0.020 rows=1.50 loops=4)')).toMatchObject({
      'Actual Total Time': 0.02,
      'Actual Rows': 1.5,
      'Actual Loops': 4,
    });
    const costsOff = parseNodeLine('Seq Scan on t');
    expect(costsOff).toEqual({ 'Node Type': 'Seq Scan', 'Relation Name': 't', Alias: 't' });
  });

  it('parses plans without psql decoration, with SubPlans and PG17 InitPlans', () => {
    const plan = parseTextPlan(`Seq Scan on orders o  (cost=0.00..100.00 rows=10 width=4) (actual time=0.1..5.0 rows=10 loops=1)
  Filter: ((o.total > (InitPlan 1).col1) AND (SubPlan 2))
  InitPlan 1
    ->  Aggregate  (cost=1.00..1.01 rows=1 width=32) (actual time=1.0..1.0 rows=1 loops=1)
          ->  Seq Scan on orders  (cost=0.00..1.00 rows=100 width=4) (actual time=0.01..0.5 rows=100 loops=1)
  SubPlan 2
    ->  Index Only Scan using customers_pkey on customers c  (cost=0.29..8.30 rows=1 width=0) (actual time=0.01..0.01 rows=1 loops=10)
          Index Cond: (c.customerid = o.customerid)
          Heap Fetches: 0
Planning Time: 0.1 ms
Execution Time: 5.2 ms`);

    const [initPlan, subPlan] = plan.Plan.Plans!;
    expect(initPlan).toMatchObject({ 'Parent Relationship': 'InitPlan', 'Subplan Name': 'InitPlan 1', Strategy: 'Plain' });
    expect(initPlan.Plans).toHaveLength(1);
    expect(subPlan).toMatchObject({ 'Parent Relationship': 'SubPlan', 'Subplan Name': 'SubPlan 2', 'Heap Fetches': 0, 'Actual Loops': 10 });
    expect(plan['Execution Time']).toBe(5.2);
  });

  it('parses Memoize, Incremental Sort, I/O timings, WAL, JIT and triggers', () => {
    const plan = parseTextPlan(` Insert on public.orders  (cost=0.00..1.00 rows=0 width=0) (actual time=0.5..0.5 rows=0 loops=1)
   Buffers: shared hit=10 dirtied=2 written=1
   I/O Timings: shared read=1.250 write=0.100, temp read=0.500
   WAL: records=3 fpi=1 bytes=420
   ->  Incremental Sort  (cost=0.50..1.00 rows=10 width=4) (actual time=0.1..0.2 rows=10 loops=1)
         Sort Key: a, b
         Presorted Key: a
         Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 25kB  Peak Memory: 25kB
         ->  Memoize  (cost=0.30..0.50 rows=1 width=4) (actual time=0.01..0.01 rows=1 loops=10)
               Cache Key: t.id
               Cache Mode: logical
               Hits: 7  Misses: 3  Evictions: 0  Overflows: 0  Memory Usage: 1kB
               ->  Index Scan using t_pkey on t  (cost=0.29..0.49 rows=1 width=4) (actual time=0.01..0.01 rows=1 loops=3)
                     Index Cond: (id = x.id)
 Planning Time: 0.2 ms
 JIT:
   Functions: 4
   Options: Inlining false, Optimization false, Expressions true, Deforming true
   Timing: Generation 0.5 ms (Deform 0.1 ms), Inlining 0.0 ms, Optimization 0.3 ms, Emission 4.2 ms, Total 5.0 ms
 Trigger RI_ConstraintTrigger_c_1 for constraint orders_customer_fk on orders: time=0.300 calls=1
 Trigger audit: time=1.200 calls=1
 Execution Time: 7.1 ms`);

    expect(plan.Plan).toMatchObject({
      'Node Type': 'ModifyTable',
      Operation: 'Insert',
      'Shared Dirtied Blocks': 2,
      'Shared I/O Read Time': 1.25,
      'Shared I/O Write Time': 0.1,
      'Temp I/O Read Time': 0.5,
      'WAL Records': 3,
      'WAL FPI': 1,
      'WAL Bytes': 420,
    });
    const incrementalSort = plan.Plan.Plans![0];
    expect(incrementalSort).toMatchObject({
      'Sort Key': ['a', 'b'],
      'Presorted Key': ['a'],
      'Full-sort Groups': { 'Group Count': 1, 'Sort Method': 'quicksort', 'Average Memory': '25kB', 'Peak Memory': '25kB' },
    });
    expect(incrementalSort.Plans![0]).toMatchObject({
      'Cache Key': 't.id',
      'Cache Hits': 7,
      'Cache Misses': 3,
      'Cache Evictions': 0,
      'Peak Memory Usage': 1,
    });
    expect(plan.JIT).toEqual({
      Functions: 4,
      Options: { Inlining: false, Optimization: false, Expressions: true, Deforming: true },
      Timing: { Generation: 0.5, Deform: 0.1, Inlining: 0, Optimization: 0.3, Emission: 4.2, Total: 5 },
    });
    expect(plan.Triggers).toEqual([
      { 'Trigger Name': 'RI_ConstraintTrigger_c_1', 'Constraint Name': 'orders_customer_fk', Relation: 'orders', Time: 0.3, Calls: 1 },
      { 'Trigger Name': 'audit', Time: 1.2, Calls: 1 },
    ]);
  });

  it('parses older output formats', () => {
    const plan = parseTextPlan(`Sort  (cost=1.00..2.00 rows=10 width=4) (actual time=0.1..0.2 rows=10 loops=1)
  Sort Key: a
  Sort Method: external merge  Disk: 1024kB
  I/O Timings: read=2.5 write=1.0
  ->  Seq Scan on t  (cost=0.00..1.00 rows=10 width=4) (actual time=0.01..0.05 rows=10 loops=1)
Total runtime: 0.300 ms`);

    expect(plan.Plan).toMatchObject({ 'Sort Space Used': 1024, 'Sort Space Type': 'Disk', 'I/O Read Time': 2.5, 'I/O Write Time': 1 });
    expect(plan['Total Runtime']).toBe(0.3);
  });
});
