import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { METRIC_LABELS } from '../../lib/metrics';
import type { Metric, PlanViewMode } from '../../lib/types';

const VIEWS: [PlanViewMode, string][] = [
  ['tree', 'Tree'],
  ['flame', 'Flame'],
  ['outline', 'Outline'],
];

interface Props {
  view: PlanViewMode;
  metric: Metric;
  metrics: Metric[];
  onView: (view: PlanViewMode) => void;
  onMetric: (metric: Metric) => void;
}

export function ViewControls(props: Props) {
  const { view } = props;
  const viewLabel = VIEWS.find(([v]) => v === view)![1];
  const menuRef = useRef<HTMLDetailsElement>(null);

  // close the menu on a choice or a click elsewhere
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(e.target as Node)) menuRef.current.open = false;
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const close = () => {
    if (menuRef.current) menuRef.current.open = false;
  };
  const menuProps = {
    ...props,
    onView: (v: PlanViewMode) => {
      props.onView(v);
      close();
    },
    onMetric: (m: Metric) => {
      props.onMetric(m);
      close();
    },
  };

  return (
    <>
      <div className="view-controls">
        <Toggles {...props} />
      </div>
      {/* narrow screens: both toggles live in one menu */}
      <details className="view-menu" ref={menuRef}>
        <summary className="btn">
          {viewLabel} · {METRIC_LABELS[props.metric]}
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="popover">
          <span className="section-label">View</span>
          <Toggles {...menuProps} only="view" />
          <span className="section-label">Metric</span>
          <Toggles {...menuProps} only="metric" />
        </div>
      </details>
    </>
  );
}

function Toggles({ view, metric, metrics, onView, onMetric, only }: Props & { only?: 'view' | 'metric' }) {
  return (
    <>
      {only !== 'metric' && (
        <div className="seg" role="group" aria-label="view">
          {VIEWS.map(([id, label]) => (
            <button key={id} aria-pressed={view === id} onClick={() => onView(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {only !== 'view' && (
        <div className="seg" role="group" aria-label="metric">
          {metrics.map((m) => (
            <button key={m} aria-pressed={metric === m} onClick={() => onMetric(m)}>
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
