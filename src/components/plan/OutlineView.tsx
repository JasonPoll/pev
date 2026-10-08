import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatMetric, metricMax, metricTotal, metricValue, METRIC_LABELS } from '../../lib/metrics';
import { nodeSubtitle } from '../../lib/nodes';
import type { AnalyzedNode, AnalyzedPlan, Metric } from '../../lib/types';
import { NodeTags } from './NodeTags';

interface Props {
  plan: AnalyzedPlan;
  metric: Metric;
  selectedId?: number;
  onSelect: (id: number) => void;
}

// The plan as an indented list: it grows taller rather than wider, so it works at any width.
export function OutlineView({ plan, metric, selectedId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const selectedRef = useRef<HTMLDivElement>(null);

  const max = metricMax(plan, metric);
  const total = metricTotal(plan, metric);

  // reveal the selected node if it's hidden inside a collapsed subtree
  useEffect(() => {
    if (selectedId === undefined) return;
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (let id = plan.nodes[selectedId].parentId; id !== undefined; id = plan.nodes[id].parentId) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedId, plan]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const rows: AnalyzedNode[] = [];
  const visit = (node: AnalyzedNode) => {
    rows.push(node);
    if (!collapsed.has(node.id)) node.children.forEach(visit);
  };
  visit(plan.root);

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="outline" role="tree" aria-label="plan outline">
      <div className="outline-head section-label">
        <span>Node</span>
        <span>Self {METRIC_LABELS[metric].toLowerCase()}</span>
      </div>
      {rows.map((node) => {
        const value = metricValue(node, metric);
        const faded = metric !== 'rows' && total > 0 && value / total < 0.01;
        const selected = node.id === selectedId;
        const hasChildren = node.children.length > 0;
        const expanded = !collapsed.has(node.id);

        return (
          <div
            key={node.id}
            ref={selected ? selectedRef : undefined}
            className={`outline-row${selected ? ' selected' : ''}${faded ? ' faded' : ''}`}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-selected={selected}
            style={{ paddingLeft: 6 + node.depth * 16 }}
          >
            {hasChildren ? (
              <button
                className="outline-toggle"
                aria-label={expanded ? `collapse ${node.name}` : `expand ${node.name}`}
                aria-expanded={expanded}
                onClick={() => toggle(node.id)}
              >
                <ChevronDown size={14} />
              </button>
            ) : (
              <span className="outline-toggle" aria-hidden="true" />
            )}
            <button className="outline-main" onClick={() => onSelect(node.id)}>
              <span className="outline-name">
                <b>
                  {node.name} <NodeTags node={node} limit={1} />
                </b>
                <span className="node-sub">
                  {node.subplanName && <span className="sub-cte">{node.subplanName} · </span>}
                  {nodeSubtitle(node)}
                </span>
              </span>
              <span className="outline-metric">
                <span className="node-value">{formatMetric(value, metric)}</span>
                <span className="bar-track">
                  <i style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
