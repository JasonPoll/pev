import { NODE_DESCRIPTIONS } from './nodes';
import { parseTextPlan } from './textParser';
import type { RawNode, RawPlan } from './types';

export class PlanParseError extends Error {}

// Accepts EXPLAIN output in JSON or text format, as copied from psql, pgAdmin, DBeaver and the like.
export function parsePlan(input: string): RawPlan {
  const source = stripLogPrefix(cleanInput(input));
  if (!source.trim()) {
    throw new PlanParseError('Please paste an execution plan');
  }

  const plan = /^\s*[[{]/.test(source) ? parseJsonPlan(source) : parseTextWithQuery(source);

  if (!plan.Plan || typeof plan.Plan['Node Type'] !== 'string') {
    throw new PlanParseError("The plan you submitted doesn't look like Postgres EXPLAIN output");
  }
  return plan;
}

function parseJsonPlan(source: string): RawPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new PlanParseError('The JSON you submitted is not valid');
  }

  // [{"Plan": ...}], or [{"QUERY PLAN": [{"Plan": ...}]}] as exported by some clients
  while (Array.isArray(parsed)) parsed = parsed[0];
  if (parsed && typeof parsed === 'object' && 'QUERY PLAN' in parsed) {
    return parseJsonPlan(JSON.stringify((parsed as Record<string, unknown>)['QUERY PLAN']));
  }
  return parsed as RawPlan;
}

// auto_explain writes plans to the server log after a "duration: 12.345 ms  plan:" prefix
function stripLogPrefix(source: string): string {
  const prefix = /duration: [\d.]+ ms\s+plan:[ \t]*\r?\n?/.exec(source);
  return prefix ? source.slice(prefix.index + prefix[0].length) : source;
}

// text-format auto_explain output starts with the query ("Query Text: ..."), which may span several lines;
// the plan starts at the first line that looks like a plan node
function parseTextWithQuery(source: string): RawPlan {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim());
  if (start < 0 || !/^Query Text:/.test(lines[start].trim())) return parseText(source);

  const isNode = (line: string) => /\((?:cost=|actual |never executed)/.test(line);
  let end = lines.findIndex((l, i) => i > start && isNode(l));
  if (end < 0) end = start + 1;

  // continuation lines carry the log's indentation in front of the query's own
  const indent = lines[start].length - lines[start].trimStart().length;
  const query = lines
    .slice(start, end)
    .map((l, i) => (i === 0 ? l.trim().replace(/^Query Text:\s*/, '') : l.slice(indent)))
    .join('\n')
    .trim();

  return { ...parseText(lines.slice(end).join('\n')), 'Query Text': query };
}

function parseText(source: string): RawPlan {
  let plan: RawPlan;
  try {
    plan = parseTextPlan(source);
  } catch (e) {
    throw new PlanParseError((e as Error).message);
  }

  // anything parses as a one-line text plan, so make sure it reads like one: costs, timings, child nodes,
  // or at least a node type Postgres would print
  const looksLikePlan =
    /\((?:cost=|actual |never executed)/.test(source) ||
    /^\s*->/m.test(source) ||
    NODE_DESCRIPTIONS[plan.Plan['Node Type'].toUpperCase()] !== undefined;
  if (!looksLikePlan) {
    throw new PlanParseError("The text you submitted doesn't look like Postgres EXPLAIN output");
  }
  return plan;
}

// strips psql decoration: the "QUERY PLAN" header, the dashed separator, "(N rows)" footer,
// "+" line-continuation markers, and the double quotes some GUI clients wrap each line in
export function cleanInput(input: string): string {
  let lines = input.split(/\r?\n/);

  if (lines.some((l) => l.trim()) && lines.every((l) => !l.trim() || /^\s*".*"\s*$/.test(l))) {
    lines = lines.map((l) => l.replace(/^(\s*)"(.*)"\s*$/, '$1$2').replace(/""/g, '"'));
  }

  lines = lines.filter((line) => {
    const t = line.trim();
    return t && t !== 'QUERY PLAN' && !/^-+$/.test(t) && !/^\(\d+ rows?\)$/.test(t);
  });

  const continued = lines.filter((l) => /\+$/.test(l.trimEnd()));
  if (lines.length > 1 && continued.length >= lines.length - 1) {
    lines = lines.map((l) => l.trimEnd().replace(/\s*\+$/, ''));
  }

  return lines.join('\n');
}

// plans saved by the original (2016) version of pev contain computed properties prefixed with "*"
export function stripComputedProps(node: RawNode): RawNode {
  const clean = {} as RawNode;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('*')) continue;
    clean[key] = key === 'Plans' ? (value as RawNode[]).map(stripComputedProps) : value;
  }
  return clean;
}
