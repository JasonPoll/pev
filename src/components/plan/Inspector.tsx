import { X } from 'lucide-react';
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { durationText, formatBlocks, formatNumber, formatValue } from '../../lib/format';
import { filteredFraction, nodeDescription, nodeTarget, stripParens } from '../../lib/nodes';
import type { AnalyzedNode, AnalyzedPlan, Buffers } from '../../lib/types';
import type { Finding } from '../../lib/insights';
import { NodeTags } from './NodeTags';
import { QueryTab } from './QueryTab';

interface Props {
  plan: AnalyzedPlan;
  node?: AnalyzedNode;
  query: string;
  findings: Finding[];
  onSelect: (id: number) => void;
  onClose: () => void;
  onSaveQuery: (query: string) => void;
}

const WIDTH_KEY = 'pev:inspectorWidth';

function storedNumber(key: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // only a convenience
  }
}

export function Inspector({ plan, node, query, findings, onSelect, onClose, onSaveQuery }: Props) {
  const [width, setWidth] = useState(() => storedNumber(WIDTH_KEY, 520));
  // the tab sticks as you move between nodes, so you can walk the plan with the query open
  const [tab, setTab] = useState<Tab>('overview');

  const resizeWidth = (value: number) => {
    const next = Math.min(Math.max(value, 360), window.innerWidth * 0.7);
    setWidth(next);
    store(WIDTH_KEY, next);
  };

  // drag the left edge to make the panel wider
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => resizeWidth(startWidth + startX - ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside
      className={`inspector${node ? ' open' : ''}`}
      style={{ '--inspector-w': `${width}px` } as CSSProperties}
      aria-label={node ? `${node.name} details` : 'plan overview'}
    >
      <div className="inspector-resize" onPointerDown={startResize} aria-hidden="true" />
      <div className="sheet-handle" aria-hidden="true">
        <span />
      </div>
      <div className="inspector-scroll">
        {node ? (
          <NodeInspector
            plan={plan}
            node={node}
            query={query}
            findings={findings.filter((f) => f.nodeIds.includes(node.id))}
            tab={tab}
            onTab={setTab}
            onSelect={onSelect}
            onClose={onClose}
            onSaveQuery={onSaveQuery}
          />
        ) : (
          <PlanOverview plan={plan} query={query} tab={tab} onTab={setTab} onSaveQuery={onSaveQuery} />
        )}
      </div>
    </aside>
  );
}

type Tab = 'overview' | 'query' | 'buffers' | 'workers' | 'raw';

interface TabProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
}

function Tabs({ tabs, tab, onTab }: TabProps & { tabs: [Tab, string][] }) {
  return (
    <div className="seg" role="tablist" aria-label="details">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function NodeInspector({
  plan,
  node,
  query,
  findings,
  tab: requestedTab,
  onTab,
  onSelect,
  onClose,
  onSaveQuery,
}: Omit<Props, 'node'> & TabProps & { node: AnalyzedNode }) {
  const workers = Array.isArray(node.raw.Workers) ? (node.raw.Workers as Record<string, unknown>[]) : [];

  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['query', 'Query'],
  ];
  if (node.buffers) tabs.push(['buffers', 'Buffers']);
  if (workers.length) tabs.push(['workers', 'Workers']);
  tabs.push(['raw', 'Raw']);
  // fall back to the overview when this node doesn't have the tab that was open
  const tab = tabs.some(([id]) => id === requestedTab) ? requestedTab : 'overview';

  const target = nodeTarget(node.raw);

  return (
    <div className="inspector-inner">
      <div className="inspector-head">
        <div className="title-row">
          <h2>{node.name}</h2>
          <button className="icon-btn" aria-label="close details" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {node.subplanName && <span className="eyebrow">{node.subplanName}</span>}
        {target && (
          <div className="on">
            on <code>{target}</code>
          </div>
        )}
        <NodeTags node={node} />
      </div>

      <Tabs tabs={tabs} tab={tab} onTab={onTab} />

      {tab === 'overview' &&
        findings.map((finding) => (
          <div key={finding.id} className="finding inline">
            <header>
              <span className={`severity ${finding.severity}`} aria-hidden="true" />
              {finding.title}
            </header>
            <p>{finding.detail}</p>
          </div>
        ))}
      {tab === 'overview' && <Overview plan={plan} node={node} onSelect={onSelect} />}
      {tab === 'query' && <QueryTab query={query} node={node} onSaveQuery={onSaveQuery} />}
      {tab === 'buffers' && node.buffers && <BuffersTab node={node} />}
      {tab === 'workers' && <WorkersTab workers={workers} />}
      {tab === 'raw' && <RawTab node={node} />}
    </div>
  );
}

const CONDITIONS = ['Index Cond', 'Recheck Cond', 'Hash Cond', 'Merge Cond', 'Join Filter', 'Filter', 'One-Time Filter', 'Cache Key'];
const KEYS = ['Group Key', 'Sort Key', 'Presorted Key'];

function Overview({ plan, node, onSelect }: { plan: AnalyzedPlan; node: AnalyzedNode; onSelect: (id: number) => void }) {
  const raw = node.raw;
  const executionTime = plan.stats.executionTime ?? plan.root.inclusiveDuration;
  const ran = plan.nodes.filter((n) => n.payerId === node.id);
  const payer = node.payerId !== undefined ? plan.nodes[node.payerId] : undefined;
  const filtered = filteredFraction(node);
  const description = nodeDescription(raw);

  return (
    <>
      <div className="tiles">
        {node.exclusiveDuration !== undefined ? (
          <>
            <Tile label="self time" value={durationText(node.exclusiveDuration)}>
              {executionTime ? (
                <span className="note hot">{Math.round((node.exclusiveDuration / executionTime) * 100)}% of query</span>
              ) : null}
            </Tile>
            <Tile label="total time" value={durationText(node.inclusiveDuration)}>
              <span className="note">incl. inputs</span>
            </Tile>
          </>
        ) : (
          <>
            <Tile label="self cost" value={formatNumber(node.exclusiveCost)} />
            <Tile label="total cost" value={formatValue(raw['Total Cost'])} />
          </>
        )}
        {node.totalRows !== undefined ? (
          <Tile label="rows" value={formatNumber(node.totalRows)}>
            {node.estimate && (
              <span className="note">
                est. {formatValue(raw['Plan Rows'])}
                {node.estimate.factor >= 1.5 && ` · ${formatNumber(Math.round(node.estimate.factor * 10) / 10)}× ${node.estimate.direction}`}
              </span>
            )}
          </Tile>
        ) : (
          <Tile label="est. rows" value={formatValue(raw['Plan Rows'])} />
        )}
      </div>

      {ran.length > 0 && node.inclusiveDuration !== undefined && (
        <div className="callout">
          Total time includes running{' '}
          {ran.map((n, i) => (
            <span key={n.id}>
              {i > 0 && (i === ran.length - 1 ? ' and ' : ', ')}
              <button className="btn-link" onClick={() => onSelect(n.id)}>
                {n.subplanName ?? n.name}
              </button>{' '}
              ({durationText(n.inclusiveDuration)})
            </span>
          ))}
          , which this node triggers. {ran.length > 1 ? "They're" : "It's"} subtracted from its self time and shown on{' '}
          {ran.length > 1 ? 'their own nodes' : 'its own node'}.
        </div>
      )}

      {payer && payer.id !== node.parentId && (
        <div className="callout">
          Runs when{' '}
          <button className="btn-link" onClick={() => onSelect(payer.id)}>
            {payer.name}
          </button>{' '}
          first needs it, so its time is counted there.
        </div>
      )}

      {!node.executed && <div className="callout">This node never ran: Postgres skipped it at execution time.</div>}

      {CONDITIONS.filter((key) => typeof raw[key] === 'string').map((key) => (
        <div className="detail-section" key={key}>
          <span className="section-label">{key}</span>
          <div className="expr">{stripParens(raw[key] as string)}</div>
          {key === 'Filter' && filtered !== undefined && (
            <>
              <div className="meter-row">
                <span>{formatNumber((raw['Rows Removed by Filter'] as number) * node.loops)} rows removed</span>
                <span>{Math.round(filtered * 100)}%</span>
              </div>
              <div className="meter">
                <i style={{ width: `${filtered * 100}%` }} />
              </div>
            </>
          )}
        </div>
      ))}

      {KEYS.filter((key) => Array.isArray(raw[key])).map((key) => (
        <div className="detail-section" key={key}>
          <span className="section-label">{key}</span>
          <div className="expr">{(raw[key] as string[]).join(', ')}</div>
        </div>
      ))}

      <Facts node={node} />

      {description && (
        <p className="description">
          <strong>{node.name}</strong> <span dangerouslySetInnerHTML={{ __html: description }} />
        </p>
      )}
    </>
  );
}

// node-type specific details worth calling out
function Facts({ node }: { node: AnalyzedNode }) {
  const raw = node.raw;
  const facts: [string, string][] = [];
  const has = (key: string) => raw[key] !== undefined;

  if (node.loops > 1) facts.push(['loops', node.processes > 1 ? `${formatNumber(node.loops)} across ${node.processes} processes` : formatNumber(node.loops)]);
  if (has('Workers Planned')) facts.push(['workers', `${formatValue(raw['Workers Launched'] ?? '?')} of ${formatValue(raw['Workers Planned'])} launched`]);
  if (has('Sort Method')) {
    const space = has('Sort Space Used') ? ` · ${formatValue(raw['Sort Space Used'])} kB ${String(raw['Sort Space Type']).toLowerCase()}` : '';
    facts.push(['sort', `${formatValue(raw['Sort Method'])}${space}`]);
  }
  if (has('Hash Batches')) {
    facts.push(['hash', `${formatValue(raw['Hash Buckets'])} buckets · ${formatValue(raw['Hash Batches'])} batches · ${formatValue(raw['Peak Memory Usage'])} kB`]);
  }
  if (has('Cache Hits')) {
    const hits = raw['Cache Hits'] as number;
    const misses = (raw['Cache Misses'] as number) ?? 0;
    facts.push(['cache', `${formatNumber(hits)} hits · ${formatNumber(misses)} misses (${Math.round((hits / Math.max(1, hits + misses)) * 100)}% hit)`]);
  }
  if (has('Heap Fetches')) facts.push(['heap fetches', formatValue(raw['Heap Fetches'])]);
  if (node.buffers) {
    const b = node.buffers.exclusive;
    const io = b.sharedHit + b.sharedRead + b.tempRead + b.tempWritten;
    facts.push(['buffers', io ? `${formatBlocks(b.sharedHit)} hit · ${formatBlocks(b.sharedRead)} read${b.tempWritten ? ` · ${formatBlocks(b.tempWritten)} temp written` : ''}` : 'no I/O of its own']);
  }
  if (!facts.length) return null;

  return (
    <table className="kv">
      <tbody>
        {facts.map(([key, value]) => (
          <tr key={key}>
            <th>{key}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BUFFER_ROWS: { label: string; keys: (keyof Buffers | null)[] }[] = [
  { label: 'shared', keys: ['sharedHit', 'sharedRead', 'sharedDirtied', 'sharedWritten'] },
  { label: 'local', keys: ['localHit', 'localRead', 'localDirtied', 'localWritten'] },
  { label: 'temp', keys: [null, 'tempRead', null, 'tempWritten'] },
];

function BuffersTab({ node }: { node: AnalyzedNode }) {
  const { inclusive, exclusive } = node.buffers!;
  const ioTimes = Object.entries(node.raw).filter(([key]) => key.includes('I/O'));

  const table = (title: string, buffers: Buffers) => (
    <div className="detail-section">
      <span className="section-label">{title}</span>
      <table className="num-table">
        <thead>
          <tr>
            <th>blocks</th>
            <th>hit</th>
            <th>read</th>
            <th>dirtied</th>
            <th>written</th>
          </tr>
        </thead>
        <tbody>
          {BUFFER_ROWS.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {row.keys.map((k, i) => (
                <td key={i}>{k ? formatNumber(buffers[k]) : ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {table('This node', exclusive)}
      {table('Including its inputs', inclusive)}
      {ioTimes.length > 0 && (
        <table className="kv">
          <tbody>
            {ioTimes.map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{typeof value === 'number' ? durationText(value) : formatValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="description">One block is 8 kB. Hits came from shared buffers; reads came from the OS or disk.</p>
    </>
  );
}

function WorkersTab({ workers }: { workers: Record<string, unknown>[] }) {
  return (
    <table className="num-table">
      <thead>
        <tr>
          <th>worker</th>
          <th>time</th>
          <th>rows</th>
          <th>loops</th>
          <th>hit</th>
          <th>read</th>
        </tr>
      </thead>
      <tbody>
        {workers.map((w, i) => (
          <tr key={i}>
            <td>#{formatValue(w['Worker Number'])}</td>
            <td>{typeof w['Actual Total Time'] === 'number' ? durationText(w['Actual Total Time']) : ''}</td>
            <td>{formatValue(w['Actual Rows'])}</td>
            <td>{formatValue(w['Actual Loops'])}</td>
            <td>{formatValue(w['Shared Hit Blocks'])}</td>
            <td>{formatValue(w['Shared Read Blocks'])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RawTab({ node }: { node: AnalyzedNode }) {
  const rows = Object.entries(node.raw).filter(([key]) => key !== 'Plans' && key !== 'Workers');
  return (
    <table className="kv">
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <th>{key}</th>
            <td>{formatValue(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlanOverview({
  plan,
  query,
  tab: requestedTab,
  onTab,
  onSaveQuery,
}: TabProps & { plan: AnalyzedPlan; query: string; onSaveQuery: (query: string) => void }) {
  const tab = requestedTab === 'query' ? 'query' : 'overview';
  const { source, stats } = plan;
  const settings = Object.entries(source.Settings ?? {});
  const jit = source.JIT;
  const triggers = source.Triggers ?? [];

  return (
    <div className="inspector-inner">
      <div className="inspector-head">
        <h2>Plan</h2>
        <p className="muted">Select a node to see its details.</p>
      </div>

      <Tabs
        tabs={[
          ['overview', 'Overview'],
          ['query', 'Query'],
        ]}
        tab={tab}
        onTab={onTab}
      />

      {tab === 'query' ? (
        <QueryTab query={query} onSaveQuery={onSaveQuery} />
      ) : (
        <>
        {stats.planningBuffers && (
          <table className="kv">
            <tbody>
              <tr>
                <th>planning buffers</th>
                <td>
                  {formatBlocks(stats.planningBuffers.sharedHit)} hit · {formatBlocks(stats.planningBuffers.sharedRead)} read
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {settings.length > 0 && (
          <div className="detail-section">
            <span className="section-label">Settings</span>
            <table className="kv">
              <tbody>
                {settings.map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {jit && (
          <div className="detail-section">
            <span className="section-label">JIT</span>
            <table className="kv">
              <tbody>
                {Object.entries(jit).map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{formatValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {triggers.length > 0 && (
          <div className="detail-section">
            <span className="section-label">Triggers</span>
            <table className="num-table">
              <thead>
                <tr>
                  <th>trigger</th>
                  <th>calls</th>
                  <th>time</th>
                </tr>
              </thead>
              <tbody>
                {triggers.map((t, i) => (
                  <tr key={i}>
                    <td>{t['Trigger Name']}</td>
                    <td>{formatValue(t.Calls)}</td>
                    <td>{durationText(t.Time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {children}
    </div>
  );
}
