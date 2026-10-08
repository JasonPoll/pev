import { Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { layoutTree, type PositionedNode } from '../../lib/layout';
import { compactNumber, formatMetric, metricMax, metricTotal, metricValue, rowsOut } from '../../lib/metrics';
import { nodeSubtitle } from '../../lib/nodes';
import type { AnalyzedNode, AnalyzedPlan, Metric } from '../../lib/types';
import { NodeTags } from './NodeTags';

const NODE_W = 200;
const NODE_H = 76;
const H_GAP = 20;
const V_GAP = 44;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface Props {
  plan: AnalyzedPlan;
  metric: Metric;
  selectedId?: number;
  onSelect: (id: number) => void;
  // bumped whenever a node should be scrolled into view
  focus?: { id: number; seq: number };
}

export function TreeView({ plan, metric, selectedId, onSelect, focus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const interacted = useRef(false);
  const suppressClick = useRef(false);

  const layout = useMemo(
    () => layoutTree(plan.root, { nodeWidth: NODE_W, nodeHeight: NODE_H, hGap: H_GAP, vGap: V_GAP }),
    [plan],
  );
  const positions = useMemo(() => new Map(layout.nodes.map((p) => [p.node.id, p])), [layout]);

  const max = metricMax(plan, metric);
  const total = metricTotal(plan, metric);
  const maxRows = Math.max(1, ...plan.nodes.map(rowsOut));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.width) return;
    // leave room for the zoom buttons on the left and the legend at the bottom
    const [left, right, top, bottom] = [60, 24, 40, 56];
    const available = size.width - left - right;
    const k = clamp(Math.min(available / layout.width, (size.height - top - bottom) / layout.height, 1), 0.3, 1);
    setT({ k, x: left + Math.max(0, (available - layout.width * k) / 2), y: top });
  }, [size, layout]);

  // keep the plan fitted until the user takes over
  useEffect(() => {
    if (!interacted.current) fit();
  }, [fit]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    interacted.current = true;
    setT((prev) => {
      const k = clamp(prev.k * factor, MIN_ZOOM, MAX_ZOOM);
      return { k, x: cx - (cx - prev.x) * (k / prev.k), y: cy - (cy - prev.y) * (k / prev.k) };
    });
  }, []);

  // scroll a node into view when asked to (e.g. from a finding)
  useEffect(() => {
    if (!focus || !size.width) return;
    const p = positions.get(focus.id);
    if (!p) return;
    setT((prev) => {
      const left = p.x * prev.k + prev.x;
      const top = p.y * prev.k + prev.y;
      const visible = left >= 0 && top >= 0 && left + NODE_W * prev.k <= size.width && top + NODE_H * prev.k <= size.height;
      if (visible) return prev;
      return { ...prev, x: size.width / 2 - (p.x + NODE_W / 2) * prev.k, y: size.height / 3 - (p.y + NODE_H / 2) * prev.k };
    });
    interacted.current = true;
  }, [focus, positions, size]);

  // trackpad pinches arrive as ctrl+wheel; plain wheel pans
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
      } else {
        interacted.current = true;
        setT((prev) => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // drag to pan, two fingers to pinch
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.canvas-tools, .minimap')) return;
    const el = containerRef.current!;
    const rect = el.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let lastPinch: { dist: number; cx: number; cy: number } | null = null;
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (!pointers.current.has(ev.pointerId)) return;
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const points = [...pointers.current.values()];

      if (points.length >= 2) {
        const [a, b] = points;
        const pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top };
        if (lastPinch) {
          zoomAt(pinch.cx, pinch.cy, pinch.dist / lastPinch.dist);
          const dx = pinch.cx - lastPinch.cx;
          const dy = pinch.cy - lastPinch.cy;
          setT((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        }
        lastPinch = pinch;
        dragging = true;
        return;
      }

      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      dragging = true;
      interacted.current = true;
      setPanning(true);
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      setT((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };

    const up = (ev: PointerEvent) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size > 0) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setPanning(false);
      if (dragging) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
      }
    };

    if (pointers.current.size === 1) {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  };

  const select = (id: number) => {
    if (!suppressClick.current) onSelect(id);
  };

  const zoomBy = (factor: number) => zoomAt(size.width / 2, size.height / 2, factor);

  const edgeWidth = (child: AnalyzedNode) => 1.5 + 10 * Math.sqrt(rowsOut(child) / maxRows);

  return (
    <div
      ref={containerRef}
      className={`tree-view${panning ? ' panning' : ''}`}
      onPointerDown={onPointerDown}
      role="region"
      aria-label="plan tree"
    >
      <div className="canvas-tools">
        <button className="icon-btn" aria-label="zoom in" title="zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={16} />
        </button>
        <button className="icon-btn" aria-label="zoom out" title="zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="fit to screen"
          title="fit to screen"
          onClick={() => {
            interacted.current = false;
            fit();
          }}
        >
          <Maximize size={16} />
        </button>
        <span className="zoom-level">{Math.round(t.k * 100)}%</span>
      </div>

      <div className="tree-content" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`, width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">
          {layout.edges.map(({ parent, child, subplan }) => {
            const selected = selectedId !== undefined && (child.node.id === selectedId || parent.node.id === selectedId);
            return (
              <path
                key={child.node.id}
                className={`edge${subplan ? ' subplan' : ''}${selected ? ' selected' : ''}`}
                d={edgePath(parent, child)}
                strokeWidth={subplan ? 1.5 : edgeWidth(child.node)}
              />
            );
          })}
        </svg>

        {layout.edges
          .filter(({ child, subplan }) => !subplan && edgeWidth(child.node) >= 5)
          .map(({ child }) => (
            <span
              key={child.node.id}
              className="edge-label"
              style={{ left: child.x + NODE_W / 2 + 10, top: child.y - V_GAP / 2 - 8 }}
            >
              {compactNumber(rowsOut(child.node))} rows
            </span>
          ))}

        {layout.nodes.map((p) => (
          <NodeCard
            key={p.node.id}
            position={p}
            metric={metric}
            value={metricValue(p.node, metric)}
            max={max}
            total={total}
            selected={p.node.id === selectedId}
            onSelect={select}
          />
        ))}
      </div>

      <div className="legend" aria-hidden="true">
        <span>
          <span className="legend-swatch" />
          fill = self {metric}
        </span>
        <span>
          <svg width="28" height="10">
            <path d="M2 5h24" className="edge" strokeWidth="7" />
          </svg>
          width = rows
        </span>
        <span>
          <svg width="28" height="10">
            <path d="M2 5h24" className="edge subplan" strokeWidth="1.5" />
          </svg>
          CTE / sub-plan
        </span>
      </div>

      <Minimap
        nodes={layout.nodes}
        width={layout.width}
        height={layout.height}
        transform={t}
        size={size}
        max={max}
        metric={metric}
        onMove={(x, y) => {
          interacted.current = true;
          setT((prev) => ({ ...prev, x: size.width / 2 - x * prev.k, y: size.height / 2 - y * prev.k }));
        }}
      />
    </div>
  );
}

function NodeCard({
  position,
  metric,
  value,
  max,
  total,
  selected,
  onSelect,
}: {
  position: PositionedNode;
  metric: Metric;
  value: number;
  max: number;
  total: number;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const { node, x, y } = position;
  const ratio = max > 0 ? value / max : 0;
  const faded = metric !== 'rows' && total > 0 && value / total < 0.01;

  const classes = ['node-card'];
  if (selected) classes.push('selected');
  if (faded) classes.push('faded');
  if (!node.executed) classes.push('not-executed');

  return (
    <button
      className={classes.join(' ')}
      style={{ left: x, top: y }}
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      aria-label={`${node.name}, ${formatMetric(value, metric)}`}
    >
      <span
        className="node-fill"
        style={{ width: `${ratio * 100}%`, background: `color-mix(in srgb, var(--heat) ${Math.round(14 + 36 * ratio)}%, transparent)` }}
      />
      <span className="node-body">
        {node.subplanName && <span className="eyebrow">{node.subplanName}</span>}
        <span className="node-row">
          <span className="node-name">{node.name}</span>
          <span className="node-value">{formatMetric(value, metric)}</span>
        </span>
        <span className="node-sub">{nodeSubtitle(node)}</span>
        {!node.subplanName && <NodeTags node={node} limit={2} />}
      </span>
    </button>
  );
}

function Minimap({
  nodes,
  width,
  height,
  transform,
  size,
  max,
  metric,
  onMove,
}: {
  nodes: PositionedNode[];
  width: number;
  height: number;
  transform: Transform;
  size: { width: number; height: number };
  max: number;
  metric: Metric;
  onMove: (x: number, y: number) => void;
}) {
  const scale = Math.min(160 / width, 100 / height);
  const w = width * scale;
  const h = height * scale;

  const viewport = {
    x: (-transform.x / transform.k) * scale,
    y: (-transform.y / transform.k) * scale,
    width: (size.width / transform.k) * scale,
    height: (size.height / transform.k) * scale,
  };

  // only worth showing once the plan doesn't fit
  if (viewport.x <= 0 && viewport.y <= 0 && viewport.x + viewport.width >= w && viewport.y + viewport.height >= h) {
    return null;
  }

  return (
    <div
      className="minimap"
      aria-hidden="true"
      onClick={(e) => {
        const rect = e.currentTarget.querySelector('svg')!.getBoundingClientRect();
        onMove((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
      }}
    >
      <svg width={w} height={h}>
        {nodes.map(({ node, x, y }) => {
          const ratio = max > 0 ? metricValue(node, metric) / max : 0;
          return (
            <rect
              key={node.id}
              x={x * scale}
              y={y * scale}
              width={NODE_W * scale}
              height={NODE_H * scale}
              rx={1.5}
              fill={`color-mix(in srgb, var(--heat) ${Math.round(15 + 85 * ratio)}%, var(--tag-bg))`}
            />
          );
        })}
        <rect className="viewport" {...viewport} rx={2} />
      </svg>
    </div>
  );
}

function edgePath(parent: PositionedNode, child: PositionedNode) {
  const px = parent.x + NODE_W / 2;
  const py = parent.y + NODE_H;
  const cx = child.x + NODE_W / 2;
  const cy = child.y;
  const my = (py + cy) / 2;
  return `M${cx} ${cy} C${cx} ${my} ${px} ${my} ${px} ${py}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
