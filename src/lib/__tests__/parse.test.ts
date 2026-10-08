import { describe, expect, it } from 'vitest';
import ordersJson from '../../samples/orders.json?raw';
import { cleanInput, parsePlan, PlanParseError, stripComputedProps } from '../parse';

describe('parsePlan', () => {
  it('parses EXPLAIN (FORMAT JSON) output', () => {
    const plan = parsePlan(ordersJson);
    expect(plan.Plan['Node Type']).toBe('Limit');
    expect(plan['Execution Time']).toBe(726.8);
  });

  it('accepts a bare plan object and the {"QUERY PLAN": ...} wrapper some clients export', () => {
    const inner = { Plan: { 'Node Type': 'Result' } };
    expect(parsePlan(JSON.stringify(inner)).Plan['Node Type']).toBe('Result');
    expect(parsePlan(JSON.stringify([{ 'QUERY PLAN': [inner] }])).Plan['Node Type']).toBe('Result');
  });

  it('strips psql decoration from JSON output', () => {
    const psql = `                QUERY PLAN
-------------------------------------------
 [                                        +
   {                                      +
     "Plan": {                            +
       "Node Type": "Result"              +
     }                                    +
   }                                      +
 ]
(1 row)`;
    expect(parsePlan(psql).Plan['Node Type']).toBe('Result');
  });

  it('strips the double quotes GUI clients wrap lines in', () => {
    const quoted = `"QUERY PLAN"
"Seq Scan on ""Orders"" o  (cost=0.00..1.00 rows=1 width=4)"
"  Filter: (status = 'open'::text)"`;
    const plan = parsePlan(quoted);
    expect(plan.Plan).toMatchObject({ 'Relation Name': 'Orders', Alias: 'o', Filter: "(status = 'open'::text)" });
  });

  it('rejects input that is not a plan', () => {
    expect(() => parsePlan('')).toThrow(PlanParseError);
    expect(() => parsePlan('{"Plan": ')).toThrow('The JSON you submitted is not valid');
    expect(() => parsePlan('{"foo": 1}')).toThrow(PlanParseError);
    expect(() => parsePlan('hello: world')).toThrow("doesn't look like Postgres EXPLAIN output");
    expect(parsePlan('Seq Scan on t').Plan['Node Type']).toBe('Seq Scan');
  });

  it('leaves text plans with "+" in their expressions alone', () => {
    expect(cleanInput('Result\n  Output: (1 +\n  2)')).toBe('Result\n  Output: (1 +\n  2)');
  });
});

describe('stripComputedProps', () => {
  it('removes the properties the original pev added to saved plans', () => {
    const legacy = {
      'Node Type': 'Limit',
      '*Actual Duration': 1,
      Plans: [{ 'Node Type': 'Seq Scan', '*Tags': [] }],
    };
    expect(stripComputedProps(legacy)).toEqual({ 'Node Type': 'Limit', Plans: [{ 'Node Type': 'Seq Scan' }] });
  });
});

describe('auto_explain output', () => {
  it('reads JSON plans from the server log, along with the query', () => {
    const log = `2024-05-01 10:00:00.000 UTC [4242] LOG:  duration: 12.345 ms  plan:
	{
	  "Query Text": "SELECT * FROM orders WHERE id = 1",
	  "Plan": { "Node Type": "Index Scan", "Relation Name": "orders", "Actual Total Time": 0.02 }
	}`;
    const plan = parsePlan(log);
    expect(plan.Plan).toMatchObject({ 'Node Type': 'Index Scan', 'Relation Name': 'orders' });
    expect(plan['Query Text']).toBe('SELECT * FROM orders WHERE id = 1');
  });

  it('reads text plans from the server log, including multi-line queries', () => {
    const log = `LOG:  duration: 0.986 ms  plan:
	Query Text: SELECT count(*)
	  FROM pg_class, pg_index
	  WHERE oid = indrelid AND indisunique;
	Aggregate  (cost=16.79..16.80 rows=1 width=0) (actual time=3.626..3.627 rows=1 loops=1)
	  ->  Hash Join  (cost=4.17..16.55 rows=92 width=0) (actual time=3.349..3.594 rows=92 loops=1)
	        Hash Cond: (pg_class.oid = pg_index.indrelid)
	        ->  Seq Scan on pg_class  (cost=0.00..9.55 rows=255 width=4) (actual time=0.016..0.140 rows=255 loops=1)
	        ->  Hash  (cost=3.02..3.02 rows=92 width=4) (actual time=3.238..3.238 rows=92 loops=1)
	              Buckets: 1024  Batches: 1  Memory Usage: 4kB
	              ->  Seq Scan on pg_index  (cost=0.00..3.02 rows=92 width=4) (actual time=0.008..3.187 rows=92 loops=1)
	                    Filter: indisunique`;
    const plan = parsePlan(log);
    expect(plan['Query Text']).toBe('SELECT count(*)\n  FROM pg_class, pg_index\n  WHERE oid = indrelid AND indisunique;');
    expect(plan.Plan['Node Type']).toBe('Aggregate');
    const join = plan.Plan.Plans![0];
    expect(join).toMatchObject({ 'Node Type': 'Hash Join', 'Hash Cond': '(pg_class.oid = pg_index.indrelid)' });
    expect(join.Plans!.map((p) => p['Node Type'])).toEqual(['Seq Scan', 'Hash']);
  });
});
