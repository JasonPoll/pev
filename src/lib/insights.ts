import { durationText, formatBlocks, formatNumber } from './format';
import type { AnalyzedNode, AnalyzedPlan } from './types';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  nodeIds: number[];
  // used to order findings of the same severity; roughly the share of the query affected
  impact: number;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// Plain-language observations about a plan, most important first.
export function findInsights(plan: AnalyzedPlan): Finding[] {
  const findings = [
    ...filterWaste(plan),
    ...spills(plan),
    ...repeatedInnerScans(plan),
    ...badEstimates(plan),
    ...workersNotLaunched(plan),
    ...heapFetches(plan),
    ...jit(plan),
    ...coldCache(plan),
    ...repeatedScans(plan),
  ];
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.impact - a.impact);
}

function timeShare(plan: AnalyzedPlan, node: AnalyzedNode) {
  const total = plan.stats.executionTime ?? plan.root.inclusiveDuration;
  return total && node.exclusiveDuration !== undefined ? node.exclusiveDuration / total : 0;
}

function target(node: AnalyzedNode): string | undefined {
  const raw = node.raw;
  return (raw['Relation Name'] ?? raw['CTE Name'] ?? raw['Function Name'] ?? raw.Alias) as string | undefined;
}

function described(node: AnalyzedNode) {
  const on = target(node);
  return on ? `${node.name} on ${on}` : node.name;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function percent(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}

function workMem(plan: AnalyzedPlan) {
  const setting = plan.source.Settings?.work_mem;
  return setting ? ` under work_mem = ${setting}` : '';
}

function filterWaste(plan: AnalyzedPlan): Finding[] {
  return plan.nodes.flatMap((node) => {
    const removed = num(node.raw['Rows Removed by Filter']) * node.loops;
    const kept = node.totalRows ?? 0;
    if (removed < 1000 || removed / (removed + kept) < 0.5) return [];

    const share = timeShare(plan, node);
    if (plan.hasTiming && share < 0.05) return [];

    const advice =
      node.raw['Node Type'] === 'CTE Scan'
        ? 'Filter inside the CTE, or drop MATERIALIZED so Postgres can push the filter down.'
        : node.raw['Node Type'] === 'Seq Scan'
          ? 'An index on the filtered columns would let Postgres skip them.'
          : node.raw['Node Type'] === 'Index Scan' || node.raw['Node Type'] === 'Index Only Scan'
            ? "The index doesn't cover the filter; a multicolumn or partial index might."
            : '';

    return [
      {
        id: `filter-${node.id}`,
        severity: share >= 0.15 ? 'high' : 'medium',
        title: `${described(node)} throws away ${percent(removed / (removed + kept))} of its rows`,
        detail: `${formatNumber(removed)} of ${formatNumber(removed + kept)} rows fail the filter. ${advice}`.trim(),
        nodeIds: [node.id],
        impact: share,
      } satisfies Finding,
    ];
  });
}

function spills(plan: AnalyzedPlan): Finding[] {
  return plan.nodes.flatMap((node): Finding[] => {
    const raw = node.raw;
    const share = timeShare(plan, node);
    const severity: Severity = share >= 0.15 ? 'high' : 'medium';
    const tempWritten = node.buffers?.exclusive.tempWritten ?? 0;
    const written = tempWritten ? `, writing ${formatBlocks(tempWritten)} to temp` : '';

    if (raw['Sort Space Type'] === 'Disk') {
      return [
        {
          id: `spill-${node.id}`,
          severity,
          title: `${node.name} spills to disk`,
          detail: `Sorted ${formatNumber(num(raw['Sort Space Used']))} kB on disk${workMem(plan)}. More work_mem would let it sort in memory.`,
          nodeIds: [node.id],
          impact: share,
        },
      ];
    }

    const batches = num(raw['Hash Batches']);
    if (batches > 1) {
      const original = num(raw['Original Hash Batches']) || batches;
      const needed = nextMegabytes(num(raw['Peak Memory Usage']) * batches);
      const grew = original < batches ? `Batches grew from ${original} to ${batches}` : `Used ${batches} batches`;
      return [
        {
          id: `spill-${node.id}`,
          severity,
          title: 'Hash spills to disk',
          detail: `${grew}${workMem(plan)}${written}. Around ${needed} of work_mem keeps the hash in memory.`,
          nodeIds: [node.id],
          impact: share,
        },
      ];
    }

    const aggBatches = num(raw['HashAgg Batches']);
    if (aggBatches > 1) {
      return [
        {
          id: `spill-${node.id}`,
          severity,
          title: `${node.name} spills to disk`,
          detail: `Used ${aggBatches} batches${workMem(plan)}${written}. More work_mem would keep the groups in memory.`,
          nodeIds: [node.id],
          impact: share,
        },
      ];
    }
    return [];
  });
}

// kB -> "4MB", rounded up to a power of two
function nextMegabytes(kb: number) {
  let mb = 1;
  while (mb * 1024 < kb) mb *= 2;
  return `${mb}MB`;
}

function repeatedInnerScans(plan: AnalyzedPlan): Finding[] {
  return plan.nodes
    .filter((n) => n.raw['Node Type'] === 'Seq Scan' && n.loops >= 100 && (!plan.hasTiming || timeShare(plan, n) >= 0.05))
    .map((node) => ({
      id: `loops-${node.id}`,
      severity: 'high' as const,
      title: `${described(node)} runs ${formatNumber(node.loops)} times`,
      detail: "It's on the inner side of a loop, so the table is read over and over. An index on the join columns would turn each pass into a lookup.",
      nodeIds: [node.id],
      impact: timeShare(plan, node),
    }));
}

function badEstimates(plan: AnalyzedPlan): Finding[] {
  return plan.nodes
    .filter((n) => n.estimate && n.estimate.factor >= 100)
    .sort((a, b) => b.estimate!.factor - a.estimate!.factor)
    .slice(0, 2)
    .map((node) => {
      const relation = node.raw['Relation Name'] as string | undefined;
      const perLoop = node.loops > 1 ? ' per loop' : '';
      return {
        id: `estimate-${node.id}`,
        severity: 'medium' as const,
        title: `Row estimate off by ${formatNumber(Math.round(node.estimate!.factor))}× on ${node.name}`,
        detail:
          `The planner expected ${formatNumber(num(node.raw['Plan Rows']))} rows${perLoop} but got ` +
          `${formatNumber(num(node.raw['Actual Rows']))}. ` +
          (relation
            ? `Run ANALYZE on ${relation}, or consider extended statistics.`
            : 'Stale statistics or correlated columns are the usual culprits.'),
        nodeIds: [node.id],
        impact: Math.log10(node.estimate!.factor) / 10,
      };
    });
}

function workersNotLaunched(plan: AnalyzedPlan): Finding[] {
  return plan.nodes.flatMap((node) => {
    const planned = num(node.raw['Workers Planned']);
    const launched = node.raw['Workers Launched'];
    if (typeof launched !== 'number' || launched >= planned) return [];
    return [
      {
        id: `workers-${node.id}`,
        severity: 'medium' as const,
        title: `Only ${launched} of ${planned} parallel workers launched`,
        detail: 'The server ran out of background workers; see max_parallel_workers and max_worker_processes.',
        nodeIds: [node.id],
        impact: timeShare(plan, node),
      },
    ];
  });
}

function heapFetches(plan: AnalyzedPlan): Finding[] {
  return plan.nodes.flatMap((node) => {
    const fetches = num(node.raw['Heap Fetches']);
    if (node.raw['Node Type'] !== 'Index Only Scan' || fetches < 1000 || fetches < (node.totalRows ?? 0) / 2) return [];
    const relation = target(node) ?? 'the table';
    return [
      {
        id: `heap-${node.id}`,
        severity: 'low' as const,
        title: `Index Only Scan on ${relation} still visits the table`,
        detail: `${formatNumber(fetches)} rows were fetched from the table because its visibility map is out of date. VACUUM ${relation} to fix.`,
        nodeIds: [node.id],
        impact: timeShare(plan, node),
      },
    ];
  });
}

function jit(plan: AnalyzedPlan): Finding[] {
  const { jitTime, executionTime } = plan.stats;
  if (!jitTime || !executionTime || jitTime < 0.2 * executionTime) return [];
  return [
    {
      id: 'jit',
      severity: 'medium',
      title: `JIT compilation took ${durationText(jitTime)} (${percent(jitTime / executionTime)} of execution)`,
      detail: 'For short queries JIT often costs more than it saves. Consider raising jit_above_cost, or turning jit off.',
      nodeIds: [],
      impact: jitTime / executionTime,
    },
  ];
}

function coldCache(plan: AnalyzedPlan): Finding[] {
  const buffers = plan.stats.buffers;
  if (!buffers) return [];
  const { sharedHit, sharedRead } = buffers;
  if (sharedRead < 1024 || sharedRead / (sharedHit + sharedRead) < 0.5) return [];

  const readers = plan.nodes
    .filter((n) => (n.buffers?.exclusive.sharedRead ?? 0) > 0)
    .sort((a, b) => b.buffers!.exclusive.sharedRead - a.buffers!.exclusive.sharedRead);
  return [
    {
      id: 'cold-cache',
      severity: 'low',
      title: `Cold cache: ${percent(sharedRead / (sharedHit + sharedRead))} of blocks read from disk`,
      detail: `${formatBlocks(sharedRead)} came from disk and ${formatBlocks(sharedHit)} from shared buffers. Running the query again may be much faster.`,
      nodeIds: readers.slice(0, 3).map((n) => n.id),
      impact: sharedRead / (sharedHit + sharedRead),
    },
  ];
}

function repeatedScans(plan: AnalyzedPlan): Finding[] {
  const scans = new Map<string, AnalyzedNode[]>();
  for (const node of plan.nodes) {
    const relation = node.raw['Relation Name'] as string | undefined;
    if (!relation || !/Scan$/.test(node.raw['Node Type'])) continue;
    const key = `${node.raw.Schema ? `${node.raw.Schema}.` : ''}${relation}`;
    scans.set(key, [...(scans.get(key) ?? []), node]);
  }

  return [...scans.entries()]
    .filter(([, nodes]) => nodes.length > 1)
    .map(([relation, nodes]) => ({
      id: `rescan-${relation}`,
      severity: 'low' as const,
      title: `${relation} is scanned ${nodes.length} times`,
      detail: 'Each scan reads the table separately. Combining them (for example with a window function) could avoid the repeated work.',
      nodeIds: nodes.map((n) => n.id),
      impact: nodes.reduce((sum, n) => sum + timeShare(plan, n), 0),
    }));
}
