import { formatNumber } from './format';
import type { AnalyzedNode, RawNode } from './types';

const AGGREGATE_NAMES: Record<string, string> = {
  Plain: 'Aggregate',
  Sorted: 'GroupAggregate',
  Hashed: 'HashAggregate',
  Mixed: 'MixedAggregate',
};

// the node name as text-format EXPLAIN would print it, e.g. "Parallel Seq Scan" or "Partial HashAggregate"
export function nodeDisplayName(node: RawNode): string {
  let name = node['Node Type'];

  switch (name) {
    case 'Aggregate': {
      name = AGGREGATE_NAMES[node.Strategy as string] ?? name;
      const partialMode = node['Partial Mode'] as string | undefined;
      if (partialMode && partialMode !== 'Simple') name = `${partialMode} ${name}`;
      break;
    }
    case 'SetOp':
      name = `${node.Strategy === 'Hashed' ? 'HashSetOp' : 'SetOp'}${node.Command ? ` ${node.Command}` : ''}`;
      break;
    case 'ModifyTable':
      name = (node.Operation as string) ?? name;
      break;
    case 'Foreign Scan':
      if (node.Operation && node.Operation !== 'Select') name = `Foreign ${node.Operation}`;
      break;
    case 'Index Scan':
    case 'Index Only Scan':
      if (node['Scan Direction'] === 'Backward') name = `${name} Backward`;
      break;
  }

  if (node['Async Capable']) name = `Async ${name}`;
  if (node['Parallel Aware']) name = `Parallel ${name}`;
  return name;
}

export function nodeDescription(node: RawNode): string | undefined {
  const type = node['Node Type'];
  const key = type === 'Aggregate' ? (AGGREGATE_NAMES[node.Strategy as string] ?? type) : type;
  const description = NODE_DESCRIPTIONS[key.toUpperCase()] ?? NODE_DESCRIPTIONS[type.toUpperCase()];
  if (!description) return undefined;

  return node['Parallel Aware']
    ? `${description} This node is <strong>parallel aware</strong>: its work is divided among the parallel workers.`
    : description;
}

export const NODE_DESCRIPTIONS: Record<string, string> = {
  LIMIT: 'returns a specified number of rows from a record set.',
  SORT: 'sorts a record set based on the specified sort key.',
  'INCREMENTAL SORT': `sorts a record set that is already sorted on a prefix of the sort key (the <strong>presorted
    key</strong>), sorting one group of rows at a time. It can return rows before the whole input is read.`,
  'NESTED LOOP': `merges two record sets by looping through every record in the first set and
    trying to find a match in the second set. All matching records are returned.`,
  'MERGE JOIN': 'merges two record sets by first sorting them on a <strong>join key</strong>.',
  HASH: `generates a hash table from the records in the input recordset. Hash is used by
    <strong>Hash Join</strong>.`,
  'HASH JOIN': 'joins two record sets by hashing one of them (using a <strong>Hash</strong> node).',
  AGGREGATE: 'groups records together based on a GROUP BY or aggregate function (like <code>sum()</code>).',
  GROUPAGGREGATE: `groups records together based on a GROUP BY or aggregate function (like <code>sum()</code>).
    Group Aggregate requires its input to be sorted on the group key.`,
  HASHAGGREGATE: `groups records together based on a GROUP BY or aggregate function (like <code>sum()</code>).
    Hash Aggregate uses a hash to first organize the records by a key.`,
  MIXEDAGGREGATE: `computes several grouping sets (like <code>ROLLUP</code> or <code>CUBE</code>) using a mix of
    sorting and hashing.`,
  GROUP: 'groups sorted records together based on a GROUP BY key, without computing aggregates.',
  'SEQ SCAN': `finds relevant records by sequentially scanning the input record set. When reading from a table,
    Seq Scans (unlike Index Scans) perform a single read operation (only the table is read).`,
  'INDEX SCAN': `finds relevant records based on an <strong>Index</strong>. Index Scans perform 2 read operations: one to
    read the index and another to read the actual value from the table.`,
  'INDEX ONLY SCAN': `finds relevant records based on an <strong>Index</strong>. Index Only Scans perform a single read operation
    from the index and do not read from the corresponding table (unless the visibility map says a page may hold
    invisible rows; see <strong>Heap Fetches</strong>).`,
  'BITMAP HEAP SCAN': 'searches through the pages returned by the <strong>Bitmap Index Scan</strong> for relevant rows.',
  'BITMAP INDEX SCAN': `uses a <strong>Bitmap Index</strong> (index which uses 1 bit per page) to find all relevant pages.
    Results of this node are fed to the <strong>Bitmap Heap Scan</strong>.`,
  BITMAPAND: 'combines the pages found by several <strong>Bitmap Index Scans</strong>, keeping pages found by all of them.',
  BITMAPOR: 'combines the pages found by several <strong>Bitmap Index Scans</strong>, keeping pages found by any of them.',
  'TID SCAN': 'fetches rows directly by their physical location (<code>ctid</code>).',
  'TID RANGE SCAN': 'fetches rows within a range of physical locations (<code>ctid</code>).',
  'SAMPLE SCAN': 'returns a random sample of a table (<code>TABLESAMPLE</code>).',
  'CTE SCAN': `performs a sequential scan of <strong>Common Table Expression (CTE) query</strong> results. Note that
    results of a CTE are materialized (calculated and temporarily stored).`,
  'WORKTABLE SCAN': 'scans the working table of a <strong>recursive CTE</strong> during the recursion.',
  'SUBQUERY SCAN': 'returns the results of a subquery (in the FROM clause) that could not be flattened into the outer query.',
  'FUNCTION SCAN': 'returns the rows produced by a set-returning function (like <code>generate_series()</code>).',
  'TABLE FUNCTION SCAN': 'returns the rows produced by a table function (like <code>XMLTABLE</code> or <code>JSON_TABLE</code>).',
  'VALUES SCAN': 'returns the rows of a literal <code>VALUES</code> list.',
  'NAMED TUPLESTORE SCAN': 'reads a transition table (used by statement-level triggers).',
  'FOREIGN SCAN': 'reads rows from a remote server through a <strong>foreign data wrapper</strong>.',
  'CUSTOM SCAN': 'performs a scan implemented by an extension.',
  RESULT: `returns a computed result without scanning a table (e.g. <code>SELECT 1</code>), or applies a
    <strong>One-Time Filter</strong> to skip its input entirely.`,
  PROJECTSET: 'evaluates set-returning functions in the SELECT list, producing several rows per input row.',
  APPEND: 'concatenates the results of several child nodes (used for <code>UNION ALL</code> and partitioned tables).',
  'MERGE APPEND': 'merges the sorted results of several child nodes, preserving their sort order.',
  'RECURSIVE UNION': 'evaluates a <strong>recursive CTE</strong> by repeatedly running its recursive part until no new rows are produced.',
  SETOP: 'implements <code>INTERSECT</code> or <code>EXCEPT</code> by comparing rows from two inputs.',
  UNIQUE: 'removes adjacent duplicate rows from a sorted record set (e.g. for <code>DISTINCT</code>).',
  MATERIALIZE: 'stores its input in memory (or on disk) so it can be re-scanned cheaply, e.g. by a Nested Loop.',
  MEMOIZE: `caches the results of its child for each distinct <strong>cache key</strong>, so repeated lookups
    with the same key (typically the inner side of a Nested Loop) skip the child entirely.`,
  WINDOWAGG: 'computes window functions (<code>OVER (...)</code>) on a record set sorted by the window\'s partition and order keys.',
  LOCKROWS: 'locks the selected rows (<code>FOR UPDATE</code> / <code>FOR SHARE</code>).',
  GATHER: `collects rows from <strong>parallel workers</strong> (and, usually, the leader process) in no particular order.
    Nodes below a Gather run in parallel.`,
  'GATHER MERGE': `collects sorted rows from <strong>parallel workers</strong>, merging them to preserve their sort order.
    Nodes below a Gather Merge run in parallel.`,
  MODIFYTABLE: 'inserts, updates, deletes, or merges rows in a table.',
  INSERT: 'inserts rows into a table.',
  UPDATE: 'updates rows in a table.',
  DELETE: 'deletes rows from a table.',
  MERGE: 'merges rows into a table (<code>MERGE</code>).',
  HASHSETOP: 'implements <code>INTERSECT</code> or <code>EXCEPT</code> using a hash table.',
};

// "public.orders o", or the CTE / function the node reads from
export function nodeTarget(node: RawNode): string | undefined {
  const object = (node['Relation Name'] ?? node['CTE Name'] ?? node['Function Name'] ?? node['Table Function Name']) as
    | string
    | undefined;
  if (!object) return undefined;
  const schema = node.Schema ? `${node.Schema}.` : '';
  const alias = node.Alias && node.Alias !== object ? ` ${node.Alias}` : '';
  return `${schema}${object}${alias}`;
}

// the one-line summary shown under a node's name
export function nodeSubtitle(node: AnalyzedNode): string {
  const raw = node.raw;
  if (!node.executed) return 'never executed';

  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : undefined);
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as string[]).join(', ') : undefined);
  const condition = str('Hash Cond') ?? str('Merge Cond') ?? str('Join Filter');

  let summary =
    nodeTarget(raw) ??
    (condition && stripParens(condition)) ??
    (list('Group Key') && `by ${list('Group Key')}`) ??
    (list('Sort Key') && `by ${list('Sort Key')}`) ??
    (str('Index Name') && `using ${str('Index Name')}`) ??
    (typeof raw['Workers Planned'] === 'number' ? `${raw['Workers Launched'] ?? '?'} of ${raw['Workers Planned']} workers launched` : undefined);

  if (!summary && node.totalRows !== undefined) {
    summary = `${formatNumber(node.totalRows)} ${node.totalRows === 1 ? 'row' : 'rows'}`;
  }

  if (node.processes > 1) return `${summary ? `${summary} · ` : ''}${node.processes} processes`;
  if (node.loops > 1) return `${summary ? `${summary} · ` : ''}${formatNumber(node.loops)} loops`;
  return summary ?? '';
}

// share of the rows a node read that its filter threw away
export function filteredFraction(node: AnalyzedNode): number | undefined {
  const removed = node.raw['Rows Removed by Filter'];
  if (typeof removed !== 'number' || removed === 0) return undefined;
  const total = removed * node.loops + (node.totalRows ?? 0);
  return total ? (removed * node.loops) / total : undefined;
}

export function stripParens(expr: string): string {
  return expr.startsWith('(') && expr.endsWith(')') ? expr.slice(1, -1) : expr;
}
