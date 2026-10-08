import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlightQuery } from '../../lib/highlight';
import type { AnalyzedNode } from '../../lib/types';

interface Props {
  query: string;
  node?: AnalyzedNode;
  onSaveQuery: (query: string) => void;
}

// The SQL query with the part that corresponds to the selected node highlighted.
export function QueryTab({ query, node, onSaveQuery }: Props) {
  const ref = useRef<HTMLPreElement>(null);
  const html = useMemo(() => (query ? highlightQuery(query, node?.raw) : ''), [query, node]);
  const matched = html.includes('code-key-item');

  // bring the first highlighted part of the query into view
  useLayoutEffect(() => {
    ref.current?.querySelector('.code-key-item')?.scrollIntoView({ block: 'center' });
  }, [html]);

  if (!query) return <AddQuery onSave={onSaveQuery} />;

  return (
    <div className="detail-section">
      {node && (
        <p className="muted query-match">
          {matched ? `Highlighting the parts that ${node.name} runs.` : `${node.name} has no direct counterpart in the query.`}
        </p>
      )}
      <pre ref={ref} className="query-box full" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function AddQuery({ onSave }: { onSave: (query: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="add-query">
      <p className="muted">Add the SQL that produced this plan to see which part of the query each node runs.</p>
      <textarea
        className="input"
        aria-label="SQL query"
        placeholder="SELECT …"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="btn" disabled={!draft.trim()} onClick={() => onSave(draft.trim())}>
        Save query
      </button>
    </div>
  );
}
