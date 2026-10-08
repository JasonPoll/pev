import { bufferTotal } from './analyze';
import { durationText, formatBlocks, formatNumber } from './format';
import type { AnalyzedNode, AnalyzedPlan, Metric } from './types';

export const METRIC_LABELS: Record<Metric, string> = {
  time: 'Time',
  rows: 'Rows',
  cost: 'Cost',
  buffers: 'Buffers',
};

export function availableMetrics(plan: AnalyzedPlan): Metric[] {
  const metrics: Metric[] = [];
  if (plan.hasTiming) metrics.push('time');
  if (plan.nodes.some((n) => n.totalRows !== undefined)) metrics.push('rows');
  metrics.push('cost');
  if (plan.hasBuffers) metrics.push('buffers');
  return metrics;
}

// the node's own share of a metric (rows are the rows the node produced)
export function metricValue(node: AnalyzedNode, metric: Metric): number {
  switch (metric) {
    case 'time':
      return node.exclusiveDuration ?? 0;
    case 'rows':
      return node.totalRows ?? 0;
    case 'cost':
      return node.exclusiveCost;
    case 'buffers':
      return node.buffers ? bufferTotal(node.buffers.exclusive) : 0;
  }
}

export function metricMax(plan: AnalyzedPlan, metric: Metric): number {
  return Math.max(0, ...plan.nodes.map((n) => metricValue(n, metric)));
}

export function metricTotal(plan: AnalyzedPlan, metric: Metric): number {
  if (metric === 'rows') return metricMax(plan, metric);
  return plan.nodes.reduce((sum, n) => sum + metricValue(n, metric), 0);
}

export function formatMetric(value: number, metric: Metric): string {
  switch (metric) {
    case 'time':
      return durationText(value);
    case 'rows':
      return formatNumber(value);
    case 'cost':
      return formatNumber(value);
    case 'buffers':
      return formatBlocks(value);
  }
}

// 60351 -> "60.4k"
export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

// rows flowing out of a node: actual rows if the plan was analyzed, otherwise the planner's estimate
export function rowsOut(node: AnalyzedNode): number {
  return node.totalRows ?? ((node.raw['Plan Rows'] as number | undefined) ?? 0);
}
