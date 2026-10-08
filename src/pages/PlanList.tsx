import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { analyzePlan } from '../lib/analyze';
import { durationText, formatDate } from '../lib/format';
import { findInsights } from '../lib/insights';
import { deletePlan, getPlans } from '../lib/storage';
import type { StoredPlan } from '../lib/types';

export function PlanList() {
  const [plans, setPlans] = useState(getPlans);
  const [planToDelete, setPlanToDelete] = useState<StoredPlan | null>(null);

  const summaries = useMemo(
    () =>
      new Map(
        plans.map((plan) => {
          const analyzed = analyzePlan(plan.content);
          return [plan.id, { analyzed, finding: findInsights(analyzed)[0] }];
        }),
      ),
    [plans],
  );

  const confirmDelete = () => {
    if (planToDelete) deletePlan(planToDelete.id);
    setPlanToDelete(null);
    setPlans(getPlans());
  };

  if (!plans.length) {
    return (
      <div className="page empty">
        <h1>Welcome to pev</h1>
        <p>Paste a Postgres EXPLAIN plan to see where your query spends its time.</p>
        <Link className="btn btn-brand" to="/plans/new">
          <Plus size={15} aria-hidden="true" />
          New plan
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Plans</h1>
        <span className="muted">Stored in this browser only</span>
      </div>

      <div className="plan-cards">
        {plans.map((plan) => {
          const { analyzed, finding } = summaries.get(plan.id)!;
          return (
            <article className="plan-card" key={plan.id}>
              <Link className="cover" to={`/plans/${plan.id}`}>
                {plan.name}
              </Link>
              <div className="facts">
                {analyzed.stats.executionTime !== undefined && (
                  <span>
                    <span className="mono">{durationText(analyzed.stats.executionTime)}</span> execution
                  </span>
                )}
                <span>
                  <span className="mono">{analyzed.nodes.length}</span> nodes
                </span>
                <span>{formatDate(plan.createdOn)}</span>
              </div>
              {finding && (
                <div className="top-finding">
                  <span className={`severity ${finding.severity}`} aria-hidden="true" />
                  {finding.title}
                </div>
              )}
              <button className="icon-btn bare delete" aria-label={`delete ${plan.name}`} onClick={() => setPlanToDelete(plan)}>
                <Trash2 size={15} />
              </button>
            </article>
          );
        })}
      </div>

      <ConfirmDialog
        open={planToDelete !== null}
        message={`Delete plan "${planToDelete?.name}"? This can't be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => setPlanToDelete(null)}
      />
    </div>
  );
}
