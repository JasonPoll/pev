import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PlanParseError } from '../lib/parse';
import { readImportParams, type ImportedPlan } from '../lib/share';
import { createPlan } from '../lib/storage';

// Opens a plan passed in the link (see lib/share.ts): saves it like a submitted plan, then shows it.
export function PlanImport() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [imported, setImported] = useState<ImportedPlan>();
  const started = useRef(false);

  useEffect(() => {
    // effects run twice in development; the plan must only be saved once
    if (started.current) return;
    started.current = true;

    readImportParams(params)
      .then((data) => {
        setImported(data);
        if (!data.plan.trim()) throw new PlanParseError('This link has no plan in it.');
        const plan = createPlan(data.name, data.plan, data.query);
        // replace, so that going back doesn't import the plan again
        navigate(`/plans/${plan.id}`, { replace: true });
      })
      .catch((e: unknown) => {
        setError(e instanceof PlanParseError ? e.message : "This link's plan couldn't be read. It may be truncated.");
      });
  }, [params, navigate]);

  if (!error) {
    return <div className="page empty">Opening plan…</div>;
  }

  return (
    <div className="page empty">
      <h1>Couldn't open this plan</h1>
      <p className="error">{error}</p>
      <div className="form-row">
        {imported?.plan && (
          <Link className="btn btn-brand" to="/plans/new" state={imported}>
            Edit it as a new plan
          </Link>
        )}
        <Link className="btn" to="/plans">
          Back to plans
        </Link>
      </div>
    </div>
  );
}
