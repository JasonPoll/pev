import { Check, Link2, Pencil } from 'lucide-react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router';
import { HeaderSlotContext } from '../components/HeaderSlot';
import { FlameView } from '../components/plan/FlameView';
import { InsightsButton, InsightsPanel } from '../components/plan/Findings';
import { Inspector } from '../components/plan/Inspector';
import { OutlineView } from '../components/plan/OutlineView';
import { StatsStrip } from '../components/plan/StatsStrip';
import { TreeView } from '../components/plan/TreeView';
import { ViewControls } from '../components/plan/ViewControls';
import { analyzePlan } from '../lib/analyze';
import { findInsights } from '../lib/insights';
import { availableMetrics } from '../lib/metrics';
import { buildImportUrl } from '../lib/share';
import { getPlan, loadViewOptions, savePlan, saveViewOptions } from '../lib/storage';
import type { ViewOptions } from '../lib/types';

export function PlanView() {
  const { id } = useParams();
  const headerSlot = useContext(HeaderSlotContext);
  const [stored, setStored] = useState(() => (id ? getPlan(id) : undefined));
  const [options, setOptions] = useState(loadViewOptions);
  const [selectedId, setSelectedId] = useState<number>();
  const [focus, setFocus] = useState<{ id: number; seq: number }>();
  const [insightsOpen, setInsightsOpen] = useState(false);

  const plan = useMemo(() => (stored ? analyzePlan(stored.content) : undefined), [stored?.content]);
  const findings = useMemo(() => (plan ? findInsights(plan) : []), [plan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!stored || !plan) {
    return (
      <div className="page empty">
        This plan doesn't exist (it may have been deleted).
        <Link className="btn" to="/plans">
          Back to plans
        </Link>
      </div>
    );
  }

  const metrics = availableMetrics(plan);
  const metric = metrics.includes(options.metric) ? options.metric : metrics[0];

  const update = (changes: Partial<ViewOptions>) => {
    const next = { ...options, ...changes };
    setOptions(next);
    saveViewOptions(next);
  };

  const select = (nodeId: number) => setSelectedId((current) => (current === nodeId ? undefined : nodeId));

  const show = (nodeIds: number[]) => {
    if (!nodeIds.length) {
      setSelectedId(undefined);
      return;
    }
    setSelectedId(nodeIds[0]);
    setFocus((prev) => ({ id: nodeIds[0], seq: (prev?.seq ?? 0) + 1 }));
  };

  const rename = (name: string) => {
    const renamed = { ...stored, name };
    setStored(renamed);
    savePlan(renamed);
  };

  // a link that opens this plan (and its query) in pev; the plan travels in the URL fragment
  const copyLink = async () => {
    const plan = JSON.stringify([stored.content]);
    const url = await buildImportUrl(`${location.origin}${location.pathname}`, { plan, query: stored.query, name: stored.name });
    await navigator.clipboard.writeText(url);
  };

  const viewProps = { plan, metric, selectedId, onSelect: select };
  const selected = selectedId !== undefined ? plan.nodes[selectedId] : undefined;

  return (
    <div className="plan-page">
      {headerSlot &&
        createPortal(
          <>
            <PlanTitle name={stored.name} onRename={rename} onCopyLink={copyLink} />
            <ViewControls
              view={options.view}
              metric={metric}
              metrics={metrics}
              onView={(view) => update({ view })}
              onMetric={(m) => update({ metric: m })}
            />
          </>,
          headerSlot,
        )}

      <div className="plan-summary">
        <StatsStrip plan={plan} />
        <InsightsButton findings={findings} open={insightsOpen} onToggle={() => setInsightsOpen(!insightsOpen)} />
      </div>
      {insightsOpen && <InsightsPanel findings={findings} onShow={show} onClose={() => setInsightsOpen(false)} />}

      <div className={`workspace${selected ? ' has-selection' : ''}`}>
        <div className="view-area">
          {options.view === 'tree' && <TreeView {...viewProps} focus={focus} />}
          {options.view === 'flame' && <FlameView {...viewProps} />}
          {options.view === 'outline' && <OutlineView {...viewProps} />}
        </div>
        <button className="inspector-backdrop" aria-label="close details" tabIndex={-1} onClick={() => setSelectedId(undefined)} />
        <Inspector plan={plan} node={selected} query={stored.query} findings={findings} onSaveQuery={(query) => {
            const updated = { ...stored, query };
            setStored(updated);
            savePlan(updated);
          }} onSelect={(nodeId) => show([nodeId])} onClose={() => setSelectedId(undefined)} />
      </div>
    </div>
  );
}

function PlanTitle({ name, onRename, onCopyLink }: { name: string; onRename: (name: string) => void; onCopyLink: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await onCopyLink();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access can be refused; nothing useful to show
    }
  };

  return (
    <div className="plan-title">
      <Link to="/plans" className="muted">
        Plans
      </Link>
      <span className="sep">/</span>
      {editing ? (
        <input
          className="input"
          aria-label="plan name"
          autoFocus
          defaultValue={name}
          onBlur={(e) => {
            onRename(e.target.value.trim() || name);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <>
          <h1 title={name}>{name}</h1>
          <button className="icon-btn bare" aria-label="rename plan" title="rename plan" onClick={() => setEditing(true)}>
            <Pencil size={14} />
          </button>
          <button
            className="icon-btn bare"
            aria-label={copied ? 'link copied' : 'copy a link to this plan'}
            title={copied ? 'Link copied' : 'Copy a link to this plan'}
            onClick={copy}
          >
            {copied ? <Check size={14} /> : <Link2 size={14} />}
          </button>
          <span className="visually-hidden" aria-live="polite">
            {copied ? 'Link copied' : ''}
          </span>
        </>
      )}
    </div>
  );
}
