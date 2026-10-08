import { useMemo } from 'react';
import { buildFlame } from '../../lib/flame';
import { durationText, formatNumber } from '../../lib/format';
import { formatMetric, metricMax, metricValue } from '../../lib/metrics';
import type { AnalyzedPlan, Metric } from '../../lib/types';

interface Props {
  plan: AnalyzedPlan;
  metric: Metric;
  selectedId?: number;
  onSelect: (id: number) => void;
}

const ROW = 32;

// Each block's width is the node's total time (including the nodes below it); its color is the node's own
// share of the selected metric.
export function FlameView({ plan, metric, selectedId, onSelect }: Props) {
  const flame = useMemo(() => buildFlame(plan), [plan]);
  const max = metricMax(plan, metric);
  const formatTotal = (value: number) => (flame.unit === 'time' ? durationText(value) : formatNumber(value));

  return (
    <div className="flame">
      <div className="flame-head">
        <h2>{flame.unit === 'time' ? 'Where the time went' : 'Where the cost goes'}</h2>
        <div className="flame-legend">
          <span>width = total {flame.unit}</span>
          <span>
            <span className="legend-swatch" /> color = self {metric}
          </span>
          <span>
            <span className="tag">CTE</span> moved under the node that ran it
          </span>
        </div>
      </div>
      <div className="flame-chart" style={{ height: flame.depth * ROW }}>
        {flame.blocks.map((block) => {
          const { node } = block;
          const self = metricValue(node, metric);
          const heat = max > 0 ? Math.round((self / max) * 100) : 0;
          const selected = node.id === selectedId;
          const label = node.subplanName?.replace(/ \(returns .*\)$/, '').replace(/^CTE .*/, 'CTE');

          return (
            <button
              key={node.id}
              className={`flame-block${selected ? ' selected' : ''}`}
              style={{
                left: `${block.x * 100}%`,
                width: `calc(${block.width * 100}% - 2px)`,
                top: block.depth * ROW,
                background: `color-mix(in oklab, var(--heat) ${heat}%, var(--heat-low))`,
                color: heat > 65 ? '#1a1206' : undefined,
              }}
              title={`${node.name} · total ${formatTotal(block.value)} · self ${formatMetric(self, metric)}`}
              aria-label={`${node.name}, total ${formatTotal(block.value)}, self ${formatMetric(self, metric)}`}
              aria-pressed={selected}
              onClick={() => onSelect(node.id)}
            >
              {block.moved && label && <span className="tag">{label}</span>}
              <b>{node.name}</b>
              <span className="val" style={heat > 65 ? { color: 'inherit' } : undefined}>
                {formatTotal(block.value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
