// Shapes of Postgres EXPLAIN (FORMAT JSON) output. Text-format plans are parsed into the same shape.
export interface RawNode {
  'Node Type': string;
  Plans?: RawNode[];
  [key: string]: unknown;
}

export interface RawTrigger {
  'Trigger Name': string;
  'Constraint Name'?: string;
  Relation?: string;
  Time?: number;
  Calls?: number;
}

export interface RawPlan {
  Plan: RawNode;
  'Planning Time'?: number;
  'Execution Time'?: number;
  'Total Runtime'?: number; // pre-9.4 name for execution time
  Planning?: Record<string, unknown>;
  Triggers?: RawTrigger[];
  JIT?: Record<string, unknown>;
  Settings?: Record<string, string>;
  [key: string]: unknown;
}

export interface StoredPlan {
  id: string;
  name: string;
  createdOn: string;
  content: RawPlan;
  query: string;
}

export type Metric = 'time' | 'rows' | 'cost' | 'buffers';
export type PlanViewMode = 'tree' | 'flame' | 'outline';

export interface ViewOptions {
  view: PlanViewMode;
  metric: Metric;
}

export interface Buffers {
  sharedHit: number;
  sharedRead: number;
  sharedDirtied: number;
  sharedWritten: number;
  localHit: number;
  localRead: number;
  localDirtied: number;
  localWritten: number;
  tempRead: number;
  tempWritten: number;
}

export type Tag = 'slowest' | 'costliest' | 'largest' | 'bad estimate' | 'spills to disk';

export interface AnalyzedNode {
  id: number;
  raw: RawNode;
  name: string;
  children: AnalyzedNode[];
  parentId?: number;
  depth: number;
  subplanName?: string;
  // for InitPlans: the node whose execution ran this InitPlan (and whose time includes it), if known
  payerId?: number;
  executed: boolean;
  loops: number;
  // number of processes (leader + workers) the node ran in; 1 outside of Gather
  processes: number;
  inclusiveDuration?: number;
  exclusiveDuration?: number;
  totalRows?: number;
  exclusiveCost: number;
  estimate?: { factor: number; direction: 'over' | 'under' };
  buffers?: { inclusive: Buffers; exclusive: Buffers };
  tags: Tag[];
}

export interface PlanStats {
  executionTime?: number;
  planningTime?: number;
  maxDuration: number;
  maxRows: number;
  maxCost: number;
  maxBuffers: number;
  buffers?: Buffers;
  planningBuffers?: Buffers;
  jitTime?: number;
  triggerTime?: number;
}

export interface AnalyzedPlan {
  source: RawPlan;
  root: AnalyzedNode;
  nodes: AnalyzedNode[];
  stats: PlanStats;
  hasTiming: boolean;
  hasBuffers: boolean;
}
