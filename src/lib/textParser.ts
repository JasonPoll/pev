import type { RawNode, RawPlan, RawTrigger } from './types';

// Parses text-format EXPLAIN output into the same shape as EXPLAIN (FORMAT JSON).
//
// The text format is indentation based: every node line (except the root) starts with "->",
// a node's properties are indented further than its arrow, and sub-plans are introduced by
// "InitPlan N", "SubPlan N" or "CTE name" header lines.

type Target = Record<string, unknown>;

interface NodeEntry {
  indent: number;
  node: RawNode;
}

interface HeaderEntry {
  indent: number;
  header: { relationship: 'InitPlan' | 'SubPlan'; name: string; owner: RawNode };
}

interface WorkerEntry {
  indent: number;
  worker: Target;
  owner: RawNode;
}

type StackEntry = NodeEntry | HeaderEntry | WorkerEntry;

const COST_RE = /\(cost=([\d.]+)\.\.([\d.]+) rows=([\d.]+) width=(\d+)\)/;
const ACTUAL_RE = /\(actual time=([\d.]+)\.\.([\d.]+) rows=([\d.]+) loops=(\d+)\)/;
const ACTUAL_NO_TIME_RE = /\(actual rows=([\d.]+) loops=(\d+)\)/;
const NEVER_EXECUTED_RE = /\(never executed\)/;
const NODE_SUFFIX_RE = /\s*\((?:cost=|actual |never executed).*$/;

const LIST_PROPS = new Set(['Output', 'Sort Key', 'Group Key', 'Presorted Key', 'Hash Key']);

export function parseTextPlan(source: string): RawPlan {
  const result = {} as RawPlan;
  const stack: StackEntry[] = [];
  let root: RawNode | undefined;
  let section: { indent: number; target: Target; kind: string } | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const indent = line.length - line.trimStart().length;
    let text = line.trim();
    const isNode = text.startsWith('->');
    if (isNode) {
      text = text.replace(/^->\s*/, '');
    }

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];

    if (isNode) {
      const node = parseNodeLine(text);
      if (!top) {
        if (!root) {
          root = node;
        } else {
          (root.Plans ??= []).push(node);
        }
      } else if ('worker' in top) {
        (top.owner.Plans ??= []).push(node);
      } else if ('header' in top) {
        node['Parent Relationship'] = top.header.relationship;
        node['Subplan Name'] = top.header.name;
        (top.header.owner.Plans ??= []).push(node);
      } else {
        (top.node.Plans ??= []).push(node);
      }
      stack.push({ indent, node });
      section = null;
      continue;
    }

    if (!top) {
      if (!root && !isTopLevelLine(text)) {
        root = parseNodeLine(text);
        stack.push({ indent, node: root });
        continue;
      }

      if (section && indent > section.indent) {
        parseSectionLine(section, text);
        continue;
      }

      section = parseTopLevelLine(result, text, indent);
      continue;
    }

    if ('worker' in top) {
      parseDetail(top.worker, text, top.owner['Node Type']);
      continue;
    }

    const owner = 'header' in top ? top.header.owner : top.node;

    const subplan = /^(InitPlan|SubPlan)\s+\d+/.exec(text);
    if (subplan) {
      stack.push({ indent, header: { relationship: subplan[1] as 'InitPlan' | 'SubPlan', name: text, owner } });
      continue;
    }
    if (/^CTE\s+\S+$/.test(text)) {
      stack.push({ indent, header: { relationship: 'InitPlan', name: text, owner } });
      continue;
    }

    const worker = /^Worker (\d+):\s+(.*)$/.exec(text);
    if (worker) {
      stack.push({ indent, worker: parseWorkerLine(owner, Number(worker[1]), worker[2]), owner });
      continue;
    }

    parseDetail(owner, text, owner['Node Type']);
  }

  if (!root) {
    throw new Error("Couldn't find a plan in the text you submitted");
  }

  result.Plan = root;
  return result;
}

function isTopLevelLine(text: string) {
  return /^(Planning|Execution) [Tt]ime:|^Total runtime:|^Planning:$|^JIT:$|^Trigger |^Settings:|^Query Identifier:/.test(text);
}

function parseTopLevelLine(result: RawPlan, text: string, indent: number) {
  let m: RegExpExecArray | null;

  if ((m = /^(Planning|Execution) [Tt]ime: ([\d.]+) ms/.exec(text))) {
    result[`${m[1]} Time`] = Number(m[2]);
  } else if ((m = /^Total runtime: ([\d.]+) ms/.exec(text))) {
    result['Total Runtime'] = Number(m[1]);
  } else if (text === 'Planning:') {
    result.Planning = {};
    return { indent, target: result.Planning, kind: 'Planning' };
  } else if (text === 'JIT:') {
    result.JIT = {};
    return { indent, target: result.JIT, kind: 'JIT' };
  } else if ((m = /^Trigger (.+): time=([\d.]+) calls=(\d+)$/.exec(text))) {
    const name = /^(.+?)(?: for constraint (\S+))?(?: on (\S+))?$/.exec(m[1])!;
    const trigger: RawTrigger = { 'Trigger Name': name[1], Time: Number(m[2]), Calls: Number(m[3]) };
    if (name[2]) trigger['Constraint Name'] = name[2];
    if (name[3]) trigger.Relation = name[3];
    (result.Triggers ??= []).push(trigger);
  } else if ((m = /^Settings: (.*)$/.exec(text))) {
    const settings: Record<string, string> = {};
    for (const s of m[1].matchAll(/([\w.]+) = '((?:[^']|'')*)'/g)) {
      settings[s[1]] = s[2].replace(/''/g, "'");
    }
    result.Settings = settings;
  } else {
    parseDetail(result, text);
  }
  return null;
}

function parseSectionLine(section: { target: Target; kind: string }, text: string) {
  if (section.kind !== 'JIT') {
    parseDetail(section.target, text);
    return;
  }

  const [key, value] = splitKeyValue(text);
  if (key === 'Options') {
    const options: Record<string, boolean> = {};
    for (const part of value.split(', ')) {
      const [name, flag] = part.split(' ');
      options[name] = flag === 'true';
    }
    section.target.Options = options;
  } else if (key === 'Timing') {
    const timing: Record<string, number> = {};
    for (const t of value.matchAll(/(\w+) ([\d.]+) ms/g)) {
      timing[t[1]] = Number(t[2]);
    }
    section.target.Timing = timing;
  } else {
    section.target[key] = toValue(value);
  }
}

export function parseNodeLine(text: string): RawNode {
  const node = {} as RawNode;
  parseNodeName(text.replace(NODE_SUFFIX_RE, ''), node);

  let m: RegExpExecArray | null;
  if ((m = COST_RE.exec(text))) {
    node['Startup Cost'] = Number(m[1]);
    node['Total Cost'] = Number(m[2]);
    node['Plan Rows'] = Number(m[3]);
    node['Plan Width'] = Number(m[4]);
  }
  if ((m = ACTUAL_RE.exec(text))) {
    node['Actual Startup Time'] = Number(m[1]);
    node['Actual Total Time'] = Number(m[2]);
    node['Actual Rows'] = Number(m[3]);
    node['Actual Loops'] = Number(m[4]);
  } else if ((m = ACTUAL_NO_TIME_RE.exec(text))) {
    node['Actual Rows'] = Number(m[1]);
    node['Actual Loops'] = Number(m[2]);
  } else if (NEVER_EXECUTED_RE.test(text)) {
    node['Actual Rows'] = 0;
    node['Actual Loops'] = 0;
  }
  return node;
}

function parseNodeName(fullName: string, node: RawNode) {
  let name = fullName.trim();

  if (name.startsWith('Parallel ')) {
    node['Parallel Aware'] = true;
    name = name.slice('Parallel '.length);
  }
  if (name.startsWith('Async ')) {
    node['Async Capable'] = true;
    name = name.slice('Async '.length);
  }

  let base = name;
  let target: string | undefined;
  let m: RegExpExecArray | null;

  if ((m = /^(Index Scan|Index Only Scan)( Backward)? using (\S+) on (.+)$/.exec(name))) {
    base = m[1];
    node['Scan Direction'] = m[2] ? 'Backward' : 'Forward';
    node['Index Name'] = unquote(m[3]);
    target = m[4];
  } else if ((m = /^Bitmap Index Scan on (.+)$/.exec(name))) {
    base = 'Bitmap Index Scan';
    node['Index Name'] = unquote(m[1]);
  } else if ((m = /^(.+?) on (.+)$/.exec(name))) {
    base = m[1];
    target = m[2];
  }

  if ((m = /^(Hash|Merge) (?:(.+) )?Join$/.exec(base))) {
    node['Node Type'] = `${m[1]} Join`;
    node['Join Type'] = m[2] ?? 'Inner';
  } else if ((m = /^Nested Loop(?: (.+) Join)?$/.exec(base))) {
    node['Node Type'] = 'Nested Loop';
    node['Join Type'] = m[1] ?? 'Inner';
  } else if ((m = /^(Partial |Finalize )?(Aggregate|GroupAggregate|HashAggregate|MixedAggregate)$/.exec(base))) {
    node['Node Type'] = 'Aggregate';
    node.Strategy = { Aggregate: 'Plain', GroupAggregate: 'Sorted', HashAggregate: 'Hashed', MixedAggregate: 'Mixed' }[m[2]];
    node['Partial Mode'] = m[1] ? m[1].trim() : 'Simple';
  } else if ((m = /^(HashSetOp|SetOp) (.+)$/.exec(base))) {
    node['Node Type'] = 'SetOp';
    node.Strategy = m[1] === 'HashSetOp' ? 'Hashed' : 'Sorted';
    node.Command = m[2];
  } else if ((m = /^(Insert|Update|Delete|Merge)$/.exec(base))) {
    node['Node Type'] = 'ModifyTable';
    node.Operation = m[1];
  } else if ((m = /^Foreign (Insert|Update|Delete)$/.exec(base))) {
    node['Node Type'] = 'Foreign Scan';
    node.Operation = m[1];
  } else {
    node['Node Type'] = base;
  }

  if (target) {
    applyTarget(node, target);
  }
}

// "public.orders o" -> Schema, Relation Name and Alias (or the type-specific equivalent)
function applyTarget(node: RawNode, target: string) {
  const [object, alias] = target.trim().split(/\s+/);
  const dot = object.lastIndexOf('.');
  const schema = dot > 0 && !object.startsWith('"') ? object.slice(0, dot) : undefined;
  const objectName = unquote(schema ? object.slice(dot + 1) : object);

  switch (node['Node Type']) {
    case 'CTE Scan':
    case 'WorkTable Scan':
      node['CTE Name'] = objectName;
      break;
    case 'Function Scan':
      node['Function Name'] = objectName;
      break;
    case 'Table Function Scan':
      node['Table Function Name'] = objectName;
      break;
    case 'Named Tuplestore Scan':
      node['Tuplestore Name'] = objectName;
      break;
    case 'Subquery Scan':
    case 'Values Scan':
      node.Alias = objectName;
      return;
    default:
      node['Relation Name'] = objectName;
  }

  if (schema) node.Schema = unquote(schema);
  node.Alias = alias ? unquote(alias) : objectName;
}

function parseWorkerLine(owner: RawNode, workerNumber: number, text: string): Target {
  const workers = (owner.Workers ??= []) as Target[];
  let worker = workers.find((w) => w['Worker Number'] === workerNumber);
  if (!worker) {
    worker = { 'Worker Number': workerNumber };
    workers.push(worker);
  }

  let m: RegExpExecArray | null;
  if ((m = /^actual time=([\d.]+)\.\.([\d.]+) rows=([\d.]+) loops=(\d+)/.exec(text))) {
    worker['Actual Startup Time'] = Number(m[1]);
    worker['Actual Total Time'] = Number(m[2]);
    worker['Actual Rows'] = Number(m[3]);
    worker['Actual Loops'] = Number(m[4]);
  } else if ((m = /^actual rows=([\d.]+) loops=(\d+)/.exec(text))) {
    worker['Actual Rows'] = Number(m[1]);
    worker['Actual Loops'] = Number(m[2]);
  } else {
    parseDetail(worker, text, owner['Node Type']);
  }
  return worker;
}

function parseDetail(target: Target, text: string, nodeType?: string) {
  const [key, value] = splitKeyValue(text);

  switch (key) {
    case 'Buffers':
      parseBuffers(target, value);
      return;
    case 'I/O Timings':
      parseIoTimings(target, value);
      return;
    case 'WAL':
      for (const [k, v] of keyValuePairs(value)) {
        target[`WAL ${k === 'fpi' ? 'FPI' : capitalize(k)}`] = Number(v);
      }
      return;
    case 'Heap Blocks':
      for (const [k, v] of keyValuePairs(value)) {
        target[`${capitalize(k)} Heap Blocks`] = Number(v);
      }
      return;
    case 'Full-sort Groups':
    case 'Pre-sorted Groups': {
      const group: Target = {};
      const [first, ...rest] = text.split(/\s{2,}/);
      group['Group Count'] = toValue(splitKeyValue(first)[1]);
      for (const part of rest) {
        const [k, v] = splitKeyValue(part);
        group[k] = toValue(v);
      }
      target[key] = group;
      return;
    }
  }

  if (/\s{2,}[A-Z][\w -]*: /.test(text) || key === 'Buckets' || key === 'Batches') {
    parseMultiPair(target, text, nodeType);
  } else if (LIST_PROPS.has(key)) {
    target[key] = splitTopLevel(value);
  } else if (key) {
    target[key] = toValue(value);
  }
}

// lines with several "Key: value" pairs separated by two or more spaces, e.g.
// "Buckets: 1024  Batches: 1  Memory Usage: 425kB"
function parseMultiPair(target: Target, text: string, nodeType?: string) {
  const isMemoize = nodeType === 'Memoize';

  for (const part of text.split(/\s{2,}/)) {
    const [key, value] = splitKeyValue(part);
    const originally = /^(\d+) \(originally (\d+)\)$/.exec(value);

    switch (key) {
      case 'Memory':
      case 'Disk':
        target['Sort Space Used'] = parseKb(value);
        target['Sort Space Type'] = key;
        break;
      case 'Buckets':
        target['Hash Buckets'] = Number(originally ? originally[1] : value);
        target['Original Hash Buckets'] = Number(originally ? originally[2] : value);
        break;
      case 'Batches':
        if (nodeType === 'Hash') {
          target['Hash Batches'] = Number(originally ? originally[1] : value);
          target['Original Hash Batches'] = Number(originally ? originally[2] : value);
        } else {
          target['HashAgg Batches'] = Number(value);
        }
        break;
      case 'Memory Usage':
        target['Peak Memory Usage'] = parseKb(value);
        break;
      case 'Disk Usage':
        target['Disk Usage'] = parseKb(value);
        break;
      case 'Hits':
      case 'Misses':
      case 'Evictions':
      case 'Overflows':
        target[isMemoize ? `Cache ${key}` : key] = Number(value);
        break;
      default:
        target[key] = toValue(value);
    }
  }
}

// "shared hit=23 read=1392 dirtied=2, local hit=1, temp read=10 written=20"
function parseBuffers(target: Target, value: string) {
  for (const part of value.split(/,\s*/)) {
    const [kind, ...pairs] = part.trim().split(/\s+/);
    for (const [k, v] of keyValuePairs(pairs.join(' '))) {
      target[`${capitalize(kind)} ${capitalize(k)} Blocks`] = Number(v);
    }
  }
}

// "read=1.2 write=0.3" (<= PG14), "shared/local read=1.2, temp read=0.5" (PG15),
// "shared read=1.2 write=0.3, local read=0.1, temp read=0.5" (PG16+)
function parseIoTimings(target: Target, value: string) {
  for (const part of value.split(/,\s*/)) {
    const words = part.trim().split(/\s+/);
    const prefix = words[0].includes('=') ? '' : words.shift()!;
    const label = prefix === '' || prefix === 'shared/local' ? '' : `${capitalize(prefix)} `;
    for (const [k, v] of keyValuePairs(words.join(' '))) {
      target[`${label}I/O ${capitalize(k)} Time`] = Number(v);
    }
  }
}

function splitKeyValue(text: string): [string, string] {
  const idx = text.indexOf(': ');
  if (idx < 0) {
    return text.endsWith(':') ? [text.slice(0, -1), ''] : [text, ''];
  }
  return [text.slice(0, idx), text.slice(idx + 2).trim()];
}

function keyValuePairs(text: string): [string, string][] {
  return [...text.matchAll(/([\w/]+)=(\S+)/g)].map((m) => [m[1], m[2]]);
}

// splits on commas that are not nested inside parentheses or quotes
export function splitTopLevel(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function toValue(value: string): string | number | boolean {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value;
}

function parseKb(value: string) {
  return Number(value.replace(/kB$/, ''));
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function unquote(s: string) {
  return s.replace(/^"(.*)"$/, '$1');
}
