import { durationText, formatBlocks, formatDuration, formatNumber } from '../../lib/format';
import type { AnalyzedPlan } from '../../lib/types';

export function StatsStrip({ plan }: { plan: AnalyzedPlan }) {
  const { stats, nodes } = plan;
  const execution = formatDuration(stats.executionTime);

  const gathers = nodes.filter((n) => typeof n.raw['Workers Planned'] === 'number');
  const workersPlanned = gathers.reduce((sum, n) => sum + (n.raw['Workers Planned'] as number), 0);
  const workersLaunched = gathers.reduce((sum, n) => sum + ((n.raw['Workers Launched'] as number | undefined) ?? 0), 0);

  const buffers = stats.buffers;
  const shared = buffers ? buffers.sharedHit + buffers.sharedRead : 0;

  return (
    <section className="stats" aria-label="plan statistics">
      {stats.executionTime !== undefined ? (
        <Stat primary value={execution.value} unit={execution.unit} label="execution" />
      ) : (
        <Stat primary value={formatNumber(plan.root.raw['Total Cost'] as number)} label="total cost (not analyzed)" />
      )}
      {stats.planningTime !== undefined && <Stat value={durationText(stats.planningTime)} label="planning" />}
      <Stat value={String(nodes.length)} label="nodes" />
      {gathers.length > 0 && <Stat value={`${workersLaunched} / ${workersPlanned}`} label="workers launched" />}
      {buffers && shared > 0 && <Stat value={`${Math.round((buffers.sharedHit / shared) * 100)}%`} label="cache hit ratio" />}
      {buffers && buffers.sharedRead > 0 && <Stat value={formatBlocks(buffers.sharedRead)} label="read from disk" />}
      {buffers && buffers.tempWritten > 0 && <Stat value={formatBlocks(buffers.tempWritten)} label="temp written" />}
      {stats.jitTime !== undefined && <Stat value={durationText(stats.jitTime)} label="JIT" />}
      {stats.triggerTime !== undefined && <Stat value={durationText(stats.triggerTime)} label="triggers" />}
    </section>
  );
}

function Stat({ value, unit, label, primary }: { value: string; unit?: string; label: string; primary?: boolean }) {
  return (
    <div className={`stat${primary ? ' primary' : ''}`}>
      <span className="stat-value">
        {value}
        {unit && <small> {unit}</small>}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
