import { ChevronDown, Lightbulb, X } from 'lucide-react';
import type { Finding } from '../../lib/insights';

export function InsightsButton({ findings, open, onToggle }: { findings: Finding[]; open: boolean; onToggle: () => void }) {
  if (!findings.length) {
    return <span className="insights-none muted">No insights</span>;
  }

  return (
    <button className={`btn insights-button${open ? ' open' : ''}`} aria-expanded={open} aria-controls="insights" onClick={onToggle}>
      <Lightbulb size={15} aria-hidden="true" />
      Insights
      <span className={`insights-count ${findings[0].severity}`}>{findings.length}</span>
      <ChevronDown size={15} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
  );
}

export function InsightsPanel({
  findings,
  onShow,
  onClose,
}: {
  findings: Finding[];
  onShow: (nodeIds: number[]) => void;
  onClose: () => void;
}) {
  return (
    <section id="insights" className="insights-panel" aria-label="insights">
      <div className="insights-grid">
        {findings.map((finding) => (
          <FindingCard key={finding.id} finding={finding} onShow={onShow} />
        ))}
      </div>
      <button className="icon-btn bare insights-close" aria-label="close insights" onClick={onClose}>
        <X size={16} />
      </button>
    </section>
  );
}

export function FindingCard({ finding, onShow }: { finding: Finding; onShow?: (nodeIds: number[]) => void }) {
  return (
    <article className="finding">
      <header>
        <span className={`severity ${finding.severity}`} aria-label={`${finding.severity} severity`} />
        {finding.title}
      </header>
      <p>{finding.detail}</p>
      {onShow && finding.nodeIds.length > 0 && (
        <button className="btn-link" onClick={() => onShow(finding.nodeIds)}>
          {finding.nodeIds.length > 1 ? 'Show nodes' : 'Show node'}
        </button>
      )}
    </article>
  );
}
