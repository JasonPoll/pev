import { nodeDisplayName } from './nodes';
import type { AnalyzedNode, AnalyzedPlan, Buffers, RawNode, RawPlan, Tag } from './types';

// how many times the planner has to be off (in either direction) before we flag a node
export const BAD_ESTIMATE_FACTOR = 100;

const BUFFER_PROPS: Record<keyof Buffers, string> = {
  sharedHit: 'Shared Hit Blocks',
  sharedRead: 'Shared Read Blocks',
  sharedDirtied: 'Shared Dirtied Blocks',
  sharedWritten: 'Shared Written Blocks',
  localHit: 'Local Hit Blocks',
  localRead: 'Local Read Blocks',
  localDirtied: 'Local Dirtied Blocks',
  localWritten: 'Local Written Blocks',
  tempRead: 'Temp Read Blocks',
  tempWritten: 'Temp Written Blocks',
};

const BUFFER_KEYS = Object.keys(BUFFER_PROPS) as (keyof Buffers)[];

export function analyzePlan(plan: RawPlan): AnalyzedPlan {
  const nodes: AnalyzedNode[] = [];
  const parents = new Map<AnalyzedNode, AnalyzedNode>();
  const root = buildNode(plan.Plan, 1, 0, nodes, parents);

  attributeInitPlans(nodes, parents);

  const hasTiming = nodes.some((n) => n.inclusiveDuration !== undefined);
  const hasBuffers = nodes.some((n) => n.buffers !== undefined);

  const maxDuration = Math.max(0, ...nodes.map((n) => n.exclusiveDuration ?? 0));
  const maxRows = Math.max(0, ...nodes.map((n) => n.totalRows ?? 0));
  const maxCost = Math.max(0, ...nodes.map((n) => n.exclusiveCost));
  const maxBuffers = Math.max(0, ...nodes.map((n) => (n.buffers ? bufferTotal(n.buffers.exclusive) : 0)));

  for (const node of nodes) {
    node.tags = computeTags(node, { maxDuration, maxRows, maxCost });
  }

  const triggers = plan.Triggers ?? [];
  const jitTiming = (plan.JIT?.Timing ?? undefined) as Record<string, unknown> | undefined;

  return {
    source: plan,
    root,
    nodes,
    hasTiming,
    hasBuffers,
    stats: {
      executionTime: plan['Execution Time'] ?? plan['Total Runtime'],
      planningTime: plan['Planning Time'],
      maxDuration,
      maxRows,
      maxCost,
      maxBuffers,
      buffers: root.buffers?.inclusive,
      planningBuffers: plan.Planning ? readBuffers(plan.Planning) : undefined,
      jitTime: typeof jitTiming?.Total === 'number' ? jitTiming.Total : undefined,
      triggerTime: triggers.length ? triggers.reduce((sum, t) => sum + (t.Time ?? 0), 0) : undefined,
    },
  };
}

// processes is the number of processes (leader + parallel workers) the node's loops are spread across
function buildNode(
  raw: RawNode,
  processes: number,
  depth: number,
  nodes: AnalyzedNode[],
  parents: Map<AnalyzedNode, AnalyzedNode>,
): AnalyzedNode {
  const node: AnalyzedNode = {
    id: nodes.length,
    raw,
    name: nodeDisplayName(raw),
    children: [],
    depth,
    subplanName: raw['Subplan Name'] as string | undefined,
    executed: raw['Actual Loops'] !== 0,
    loops: num(raw['Actual Loops']) ?? 1,
    processes,
    exclusiveCost: 0,
    tags: [],
  };
  nodes.push(node);

  // nodes below a Gather run in every worker plus (usually) the leader
  let childProcesses = processes;
  if (raw['Node Type'] === 'Gather' || raw['Node Type'] === 'Gather Merge') {
    const workers = num(raw['Workers Launched']) ?? num(raw['Workers Planned']) ?? 0;
    childProcesses = workers + 1;
  }

  node.children = (raw.Plans ?? []).map((child) => buildNode(child, childProcesses, depth + 1, nodes, parents));
  for (const child of node.children) {
    parents.set(child, node);
    child.parentId = node.id;
  }

  // An InitPlan runs when its result is first needed, so its time and buffers are counted by whichever node
  // needs it (e.g. the CTE Scan reading a CTE) rather than the node it hangs off of. InitPlans are left out
  // here and attributed to the right node later on, in attributeInitPlans().
  const contributing = node.children.filter((c) => c.raw['Parent Relationship'] !== 'InitPlan');

  const actualTime = num(raw['Actual Total Time']);
  if (actualTime !== undefined) {
    // Actual Total Time is an average per loop; loops of parallel nodes are spread across processes
    node.inclusiveDuration = node.executed ? (actualTime * node.loops) / processes : 0;
    const childTime = sum(contributing.map((c) => c.inclusiveDuration ?? 0));
    node.exclusiveDuration = Math.max(0, node.inclusiveDuration - childTime);
  }

  const actualRows = num(raw['Actual Rows']);
  if (actualRows !== undefined) {
    node.totalRows = actualRows * node.loops;
  }

  const totalCost = num(raw['Total Cost']);
  if (totalCost !== undefined) {
    // unlike time, the cost of InitPlans is added to the cost of the node they hang off of
    const childCost = sum(node.children.map((c) => num(c.raw['Total Cost']) ?? 0));
    node.exclusiveCost = Math.max(0, totalCost - childCost);
  }

  const planRows = num(raw['Plan Rows']);
  if (actualRows !== undefined && planRows !== undefined && node.executed) {
    // treat 0 as 1 so that "expected 0, got 500" reads as a 500x miss rather than infinity
    const actual = Math.max(actualRows, 1);
    const planned = Math.max(planRows, 1);
    node.estimate =
      actual >= planned
        ? { factor: actual / planned, direction: 'under' }
        : { factor: planned / actual, direction: 'over' };
  }

  if (BUFFER_KEYS.some((k) => raw[BUFFER_PROPS[k]] !== undefined)) {
    const inclusive = readBuffers(raw);
    const exclusive = { ...inclusive };
    for (const child of contributing) {
      if (!child.buffers) continue;
      for (const k of BUFFER_KEYS) {
        exclusive[k] = Math.max(0, exclusive[k] - child.buffers.inclusive[k]);
      }
    }
    node.buffers = { inclusive, exclusive };
  }

  return node;
}

// Subtracts each InitPlan's time and buffers from the node that ran it:
// - a CTE is run by the CTE Scan reading it. With several scans we can't tell how the work was split, so we
//   leave them be.
// - other InitPlans are run by the node whose expressions reference their output ($1 up to PG16,
//   (InitPlan 1).col1 since PG17), or by the node they hang off of if no other node references them.
function attributeInitPlans(nodes: AnalyzedNode[], parents: Map<AnalyzedNode, AnalyzedNode>) {
  for (const initPlan of nodes.filter((n) => n.raw['Parent Relationship'] === 'InitPlan')) {
    const name = initPlan.subplanName ?? '';
    let payer: AnalyzedNode | undefined;

    if (isCte(initPlan)) {
      const scans = nodes.filter((n) => n.raw['Node Type'] === 'CTE Scan' && n.raw['CTE Name'] === name.slice(4));
      payer = scans.length === 1 ? scans[0] : undefined;
    } else {
      const inside = new Set(descendants(initPlan));
      const pattern = initPlanReference(name);
      const referencing = pattern
        ? nodes.filter((n) => !inside.has(n) && pattern.test(nodeExpressions(n.raw)))
        : [];
      payer = referencing.length ? deepest(referencing) : parents.get(initPlan);
    }

    if (!payer) continue;
    initPlan.payerId = payer.id;

    if (payer.exclusiveDuration !== undefined && initPlan.inclusiveDuration !== undefined) {
      payer.exclusiveDuration = Math.max(0, payer.exclusiveDuration - initPlan.inclusiveDuration);
    }
    if (payer.buffers && initPlan.buffers) {
      for (const k of BUFFER_KEYS) {
        payer.buffers.exclusive[k] = Math.max(0, payer.buffers.exclusive[k] - initPlan.buffers.inclusive[k]);
      }
    }
  }
}

// "InitPlan 1 (returns $0,$1)" -> /\$0(?!\d)|\$1(?!\d)/, "InitPlan 1" -> /\(InitPlan 1\)\.col\d/
function initPlanReference(name: string): RegExp | undefined {
  const returns = /returns (.+)\)$/.exec(name);
  if (returns) {
    const params = returns[1].split(',').map((p) => `\\${p.trim()}(?!\\d)`);
    return new RegExp(params.join('|'));
  }
  const number = /^InitPlan (\d+)/.exec(name);
  return number ? new RegExp(`\\(InitPlan ${number[1]}\\)\\.col\\d`) : undefined;
}

function nodeExpressions(raw: RawNode) {
  return Object.entries(raw)
    .filter(([key]) => key !== 'Plans' && key !== 'Subplan Name' && key !== 'Workers')
    .map(([, value]) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');
}

function descendants(node: AnalyzedNode): AnalyzedNode[] {
  return [node, ...node.children.flatMap(descendants)];
}

function deepest(candidates: AnalyzedNode[]) {
  return candidates.reduce((best, n) => (n.depth > best.depth ? n : best));
}

function computeTags(node: AnalyzedNode, max: { maxDuration: number; maxRows: number; maxCost: number }): Tag[] {
  const tags: Tag[] = [];
  if (max.maxDuration > 0 && node.exclusiveDuration === max.maxDuration) tags.push('slowest');
  if (max.maxCost > 0 && node.exclusiveCost === max.maxCost) tags.push('costliest');
  if (max.maxRows > 0 && node.totalRows === max.maxRows) tags.push('largest');
  if (node.estimate && node.estimate.factor >= BAD_ESTIMATE_FACTOR) tags.push('bad estimate');
  if (spillsToDisk(node)) tags.push('spills to disk');
  return tags;
}

function spillsToDisk(node: AnalyzedNode) {
  const raw = node.raw;
  return (
    raw['Sort Space Type'] === 'Disk' ||
    (num(raw['Hash Batches']) ?? 0) > 1 ||
    (num(raw['HashAgg Batches']) ?? 0) > 1 ||
    (node.buffers?.exclusive.tempWritten ?? 0) > 0
  );
}

function isCte(node: AnalyzedNode) {
  return node.raw['Parent Relationship'] === 'InitPlan' && (node.subplanName ?? '').startsWith('CTE ');
}

export function readBuffers(source: Record<string, unknown>): Buffers {
  const buffers = {} as Buffers;
  for (const k of BUFFER_KEYS) {
    buffers[k] = num(source[BUFFER_PROPS[k]]) ?? 0;
  }
  return buffers;
}

export function bufferTotal(b: Buffers) {
  return b.sharedHit + b.sharedRead + b.localHit + b.localRead + b.tempRead + b.tempWritten;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}
