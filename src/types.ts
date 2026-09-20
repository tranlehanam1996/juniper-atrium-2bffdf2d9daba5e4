export type ItemStatus = "planned" | "active" | "done";
export type RecurrenceType = "none" | "daily" | "weekly" | "monthly";

export interface LifeRecord {
  id: string;
  title: string;
  category: string;
  dueDate: string;
  effort: number;
  impact: number;
  status: ItemStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  recurrence?: RecurrenceType;
}

export interface CareTemplate {
  readonly title: string;
  readonly category: string;
  readonly effort: number;
  readonly impact: number;
  readonly recurrence?: RecurrenceType;
}

export interface ThemeConfig {
  readonly id: string;
  readonly product: string;
  readonly tagline: string;
  readonly itemLabel: string;
  readonly dateLabel: string;
  readonly effortLabel: string;
  readonly impactLabel: string;
  readonly categories: readonly string[];
  readonly templates: readonly CareTemplate[];
  readonly seeds: readonly (readonly [string, string, number, number])[];
}

export interface PlanEntry {
  item: LifeRecord;
  score: number;
  reasons: string[];
  daysUntilDue: number;
  isCritical?: boolean;
}

export interface PlanSummary {
  total: number;
  completed: number;
  overdue: number;
  dueSoon: number;
  effort: number;
  byCategory: Record<string, number>;
}