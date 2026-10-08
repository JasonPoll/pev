import { useRef, useState, type DragEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { PlanParseError } from '../lib/parse';
import type { ImportedPlan } from '../lib/share';
import { createPlan } from '../lib/storage';
import ordersPlan from '../samples/orders.json?raw';
import ordersQuery from '../samples/orders.sql?raw';
import revenuePlan from '../samples/revenue.txt?raw';
import revenueQuery from '../samples/revenue.sql?raw';

const SAMPLES = [
  { label: 'Sample plan (JSON)', name: 'Sample plan', plan: ordersPlan, query: ordersQuery },
  { label: 'Sample parallel plan (text)', name: 'Sample parallel plan', plan: revenuePlan, query: revenueQuery },
];

function detectFormat(text: string) {
  const trimmed = text
    .replace(/^[\s\S]*?duration: [\d.]+ ms\s+plan:/, '')
    .replace(/^\s*(QUERY PLAN\s*)?(-+\s*)?/, '')
    .trimStart();
  if (!trimmed) return '';
  const format = /^[[{]/.test(trimmed) ? 'JSON' : 'text';
  return /"?Query Text"?:/.test(trimmed) ? `${format}, includes the query` : format;
}

export function PlanNew() {
  const navigate = useNavigate();
  // a link that couldn't be imported sends its contents here to be fixed up
  const linked = useLocation().state as ImportedPlan | null;
  const [name, setName] = useState(linked?.name ?? '');
  const [content, setContent] = useState(linked?.plan ?? '');
  const [query, setQuery] = useState(linked?.query ?? '');
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const submit = () => {
    try {
      const plan = createPlan(name, content, query);
      navigate(`/plans/${plan.id}`);
    } catch (e) {
      if (!(e instanceof PlanParseError)) throw e;
      setError(e.message);
    }
  };

  const prefill = (sample: (typeof SAMPLES)[number]) => {
    setName(sample.name);
    setContent(sample.plan);
    setQuery(sample.query);
    setError('');
  };

  const dropFile = async (e: DragEvent<HTMLTextAreaElement>, setValue: (value: string) => void) => {
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    setValue(await file.text());
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    setContent(await file.text());
    setError('');
  };

  const format = detectFormat(content);

  return (
    <div className="page">
      <div className="page-head">
        <h1>New plan</h1>
        <div className="form-row">
          {SAMPLES.map((sample) => (
            <button key={sample.label} className="btn" onClick={() => prefill(sample)}>
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      <p className="muted">
        For best results use <code>EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON)</code>; text output works
        too. Plans are stored in this browser and never sent anywhere.
      </p>

      <div className="form-row">
        <input
          className="input"
          placeholder="Name (optional)"
          aria-label="plan name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-brand" onClick={submit} disabled={!content.trim()}>
          Visualize
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className={`drop-zone${dragOver ? ' over' : ''}`}>
        <div className="field-label">
          <label htmlFor="plan-input">Execution plan</label>
          <span className="format-hint">{format ? `${format} detected` : 'paste, drop or choose a file'}</span>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Choose file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.txt,.log,.sql,text/plain,application/json"
            hidden
            onChange={(e) => {
              openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          id="plan-input"
          className="input"
          value={content}
          spellCheck={false}
          placeholder="EXPLAIN output (JSON or text), or an auto_explain log entry"
          onChange={(e) => {
            setContent(e.target.value);
            setError('');
          }}
          onDragOver={() => setDragOver(true)}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => dropFile(e, setContent)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="query-input">
          SQL query <span className="format-hint">optional · links nodes to the query</span>
        </label>
        <textarea
          id="query-input"
          className="input"
          rows={8}
          value={query}
          spellCheck={false}
          placeholder="SELECT …"
          onChange={(e) => setQuery(e.target.value)}
          onDrop={(e) => dropFile(e, setQuery)}
        />
      </div>
    </div>
  );
}
