import hljs from 'highlight.js/lib/core';
import pgsql from 'highlight.js/lib/languages/pgsql';
import type { RawNode } from './types';

hljs.registerLanguage('pgsql', pgsql);

// a table name only counts where the query reads from (or writes to) a table, not e.g. "count(*) AS orders"
const TABLE_POSITION = '(?<=\\b(?:from|join|update|into|using|only)\\s+)';
const CLAUSE_KEYWORDS =
  'where|join|inner|left|right|full|cross|natural|lateral|on|using|group|order|limit|offset|having|window|' +
  'union|except|intersect|for|returning|set|values|tablesample';

const CONDITION_PROPS = ['Hash Cond', 'Merge Cond', 'Join Filter', 'Index Cond', 'Recheck Cond', 'Filter'];

// Syntax-highlights the query and marks the parts of it that correspond to the given plan node
// (the table it scans, its join condition, its group or sort key, and so on).
export function highlightQuery(query: string, node?: RawNode): string {
  const html = hljs.highlight(query, { language: 'pgsql', ignoreIllegals: true }).value;
  if (!node) return html;

  const ranges = findRanges(query, keyPatterns(node));
  return ranges.length ? markRanges(html, ranges) : html;
}

export function keyPatterns(node: RawNode): RegExp[] {
  const patterns: RegExp[] = [];
  const str = (key: string) => (typeof node[key] === 'string' ? (node[key] as string) : undefined);

  const relation = str('Relation Name');
  if (relation) {
    const schema = str('Schema');
    const alias = str('Alias');
    const rel = `${schema ? `(?:${identifier(schema)}\\.)?` : ''}${identifier(relation)}`;
    // the alias tells apart several scans of the same table: "orders o" vs. a bare "orders"
    const aliasPart =
      alias && alias !== relation
        ? `\\s+(?:as\\s+)?${identifier(alias)}\\b`
        : `\\b(?!\\s+(?:as\\s+)?(?!(?:${CLAUSE_KEYWORDS})\\b)[a-z_"])`;
    patterns.push(new RegExp(`${TABLE_POSITION}${rel}${aliasPart}`, 'gi'));
  }

  const cte = str('CTE Name');
  if (cte) patterns.push(new RegExp(`\\b${identifier(cte)}\\b`, 'gi'));

  const fn = str('Function Name');
  if (fn) patterns.push(new RegExp(`\\b${identifier(fn)}\\s*\\(`, 'gi'));

  const groupKey = node['Group Key'];
  if (Array.isArray(groupKey)) {
    patterns.push(/\bgroup\s+by\b/gi);
    patterns.push(...groupKey.map((k) => expressionPattern(String(k))));
  }

  const sortKey = node['Sort Key'];
  if (Array.isArray(sortKey) && node['Node Type'] !== 'Incremental Sort') {
    patterns.push(/\border\s+by\b/gi);
    patterns.push(...sortKey.map((k) => expressionPattern(String(k).replace(/\s+(ASC|DESC|NULLS FIRST|NULLS LAST|USING \S+)/gi, ''))));
  }

  for (const prop of CONDITION_PROPS) {
    const condition = str(prop);
    if (!condition) continue;
    for (const part of splitConditions(condition)) {
      patterns.push(expressionPattern(part));
      const eq = /^(.+?)\s+=\s+(.+)$/.exec(part);
      if (eq) patterns.push(expressionPattern(`${eq[2]} = ${eq[1]}`));
    }
  }

  if (node['Node Type'] === 'Limit') {
    patterns.push(/\blimit\s+\S+/gi, /\boffset\s+\S+/gi);
  }

  return patterns;
}

// "((a = b) AND (c > 1))" -> ["a = b", "c > 1"]
function splitConditions(condition: string): string[] {
  const parts: string[] = [];
  const visit = (expr: string) => {
    const inner = stripOuterParens(expr.trim());
    const ands = splitTopLevelAnd(inner);
    if (ands.length > 1) {
      ands.forEach(visit);
    } else {
      parts.push(inner);
    }
  };
  visit(condition);
  return parts;
}

function splitTopLevelAnd(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (depth === 0 && expr.startsWith(' AND ', i)) {
      parts.push(expr.slice(start, i));
      start = i + ' AND '.length;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function stripOuterParens(expr: string): string {
  while (expr.startsWith('(') && expr.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < expr.length - 1; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') depth--;
      if (depth === 0) {
        balanced = false;
        break;
      }
    }
    if (!balanced) break;
    expr = expr.slice(1, -1).trim();
  }
  return expr;
}

// matches an expression as Postgres prints it in the plan against the query as the user wrote it,
// ignoring casts, parentheses and whitespace differences
function expressionPattern(expr: string): RegExp {
  const tokens = expr
    .replace(/::[\w ]+?(\[\])?(?=[\s),]|$)/g, '')
    .match(/"[^"]+"|'[^']*'|[\w.$]+|[^\s\w()"']+/g);
  if (!tokens || tokens.length > 40) return /(?!)/g;

  const body = tokens.map((t) => escapeRegExp(t.replace(/^"(.*)"$/, '$1'))).join('[\\s()"]*');
  const start = /^\w/.test(tokens[0]) ? '\\b' : '';
  const end = /\w$/.test(tokens[tokens.length - 1]) ? '\\b' : '';
  return new RegExp(`${start}${body}${end}`, 'gi');
}

function identifier(name: string) {
  return `"?${escapeRegExp(name)}"?`;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findRanges(text: string, patterns: RegExp[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      if (m[0].length) ranges.push([m.index!, m.index! + m[0].length]);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    // ranges separated only by whitespace (e.g. "GROUP BY" and the group key) read better as one
    if (last && (range[0] <= last[1] || !text.slice(last[1], range[0]).trim())) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

// wraps the given character ranges of the highlighted html's text in <mark>, splitting text nodes as needed
function markRanges(html: string, ranges: [number, number][]): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  let offset = 0;
  for (const textNode of textNodes) {
    const text = textNode.data;
    const start = offset;
    const end = offset + text.length;
    offset = end;

    const overlapping = ranges.filter(([s, e]) => s < end && e > start);
    if (!overlapping.length) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const [s, e] of overlapping) {
      const from = Math.max(s - start, 0);
      const to = Math.min(e - start, text.length);
      if (from > cursor) fragment.append(text.slice(cursor, from));
      const mark = document.createElement('mark');
      mark.className = 'code-key-item';
      mark.textContent = text.slice(from, to);
      fragment.append(mark);
      cursor = to;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    textNode.replaceWith(fragment);
  }

  return container.innerHTML;
}
