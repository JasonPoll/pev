import { formatDate } from './format';
import { parsePlan, stripComputedProps } from './parse';
import type { Metric, PlanViewMode, StoredPlan, ViewOptions } from './types';

// plans live in localStorage under "plan_<timestamp>", the same keys the original pev used
const PLAN_PREFIX = 'plan_';
const VIEW_OPTIONS_KEY = 'pev:viewOptions';

const VIEWS: PlanViewMode[] = ['tree', 'flame', 'outline'];
const METRICS: Metric[] = ['time', 'rows', 'cost', 'buffers'];

export function getPlans(): StoredPlan[] {
  const plans: StoredPlan[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PLAN_PREFIX)) continue;
    const plan = getPlan(key);
    if (plan) plans.push(plan);
  }
  return plans.sort((a, b) => b.createdOn.localeCompare(a.createdOn));
}

export function getPlan(id: string): StoredPlan | undefined {
  try {
    const plan = JSON.parse(localStorage.getItem(id) ?? 'null') as StoredPlan | null;
    if (!plan?.content?.Plan) return undefined;
    return {
      ...plan,
      createdOn: new Date(plan.createdOn).toISOString(),
      query: plan.query ?? '',
      content: { ...plan.content, Plan: stripComputedProps(plan.content.Plan) },
    };
  } catch {
    return undefined;
  }
}

// throws PlanParseError when the plan can't be parsed
export function createPlan(name: string, source: string, query: string): StoredPlan {
  const now = new Date();
  const content = parsePlan(source);
  // auto_explain output carries the query along with the plan
  const embeddedQuery = typeof content['Query Text'] === 'string' ? content['Query Text'] : '';
  const plan: StoredPlan = {
    id: PLAN_PREFIX + now.getTime(),
    name: name.trim() || `plan created on ${formatDate(now.toISOString())}`,
    createdOn: now.toISOString(),
    content,
    query: query.trim() || embeddedQuery.trim(),
  };
  savePlan(plan);
  return plan;
}

export function savePlan(plan: StoredPlan) {
  localStorage.setItem(plan.id, JSON.stringify(plan));
}

export function deletePlan(id: string) {
  localStorage.removeItem(id);
}

// phones default to the outline, which fits narrow screens better than the tree
export function loadViewOptions(): ViewOptions {
  let saved: Partial<ViewOptions> = {};
  try {
    saved = JSON.parse(localStorage.getItem(VIEW_OPTIONS_KEY) ?? '{}');
  } catch {
    // fall back to the defaults
  }
  const narrow = window.matchMedia?.('(max-width: 699px)').matches;
  return {
    view: saved.view && VIEWS.includes(saved.view) ? saved.view : narrow ? 'outline' : 'tree',
    metric: saved.metric && METRICS.includes(saved.metric) ? saved.metric : 'time',
  };
}

export function saveViewOptions(options: ViewOptions) {
  try {
    localStorage.setItem(VIEW_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // storage may be full or unavailable; view options are a convenience
  }
}
