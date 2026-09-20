import type { LifeRecord, PlanEntry, PlanSummary, ThemeConfig } from "../types";

const DAY_MS = 86_400_000;

export function localDay(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / DAY_MS);
}

export function validateRecord(input: Partial<LifeRecord>, theme: ThemeConfig): string[] {
  const errors: string[] = [];
  if (!input.title?.trim()) errors.push(`${theme.itemLabel} needs a title.`);
  if (!input.category || !theme.categories.includes(input.category)) errors.push("Choose a valid category.");
  if (!input.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) errors.push("Choose a valid date.");
  if (!Number.isFinite(input.effort) || Number(input.effort) < 1 || Number(input.effort) > 480) {
    errors.push(`${theme.effortLabel} must be between 1 and 480.`);
  }
  if (!Number.isInteger(input.impact) || Number(input.impact) < 1 || Number(input.impact) > 5) {
    errors.push(`${theme.impactLabel} must be an integer from 1 to 5.`);
  }
  return errors;
}

export function priorityFor(item: LifeRecord, today = localDay()): PlanEntry {
  const daysUntilDue = daysBetween(today, item.dueDate);
  const reasons: string[] = [];
  let score = item.impact * 12;
  let isCritical = false;

  if (daysUntilDue < 0) {
    const overdueDays = Math.abs(daysUntilDue);
    // Base overdue boost + linear growth
    score += 55 + Math.min(overdueDays, 14) * 3;
    
    if (overdueDays > 7) {
      // Stagnation penalty: items left too long become critical to prevent permanent neglect
      score += 25 + (overdueDays > 14 ? 15 : 0);
      reasons.push(`critical: ${overdueDays} day(s) overdue`);
      isCritical = true;
    } else {
      reasons.push(`${overdueDays} day(s) overdue`);
    }
  } else if (daysUntilDue === 0) {
    score += 45;
    reasons.push("due today");
  } else if (daysUntilDue <= 3) {
    score += 30 - daysUntilDue * 6;
    reasons.push(`due very soon`);
  } else if (daysUntilDue <= 7) {
    score += 20 - daysUntilDue * 2;
    reasons.push(`due in ${daysUntilDue} day(s)`);
  }

  const effortPenalty = Math.min(item.effort / 20, 12);
  score -= effortPenalty;

  if (item.status === "active") {
    score += 8;
    reasons.push("already in progress");
  }
  if (item.recurrence && item.recurrence !== "none") {
    // Habits get a slightly higher priority to keep the routine consistent
    score += 6;
    reasons.push("recurring habit");
  }
  if (item.status === "done") score = -1;
  if (reasons.length === 0) reasons.push("ranked by impact and effort");
  return { item, score: Math.round(score * 10) / 10, reasons, daysUntilDue, isCritical };
}

export function buildPlan(items: readonly LifeRecord[], today = localDay()): PlanEntry[] {
  return items
    .map((item) => priorityFor(item, today))
    .filter((entry) => entry.item.status !== "done")
    .sort((a, b) => {
      if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
      return b.score - a.score || a.item.dueDate.localeCompare(b.item.dueDate);
    });
}

export function focusedPlan(items: readonly LifeRecord[], today = localDay()): PlanEntry[] {
  const plan = buildPlan(items, today);
  return plan.filter(entry => 
    entry.item.pinned || 
    entry.isCritical ||
    entry.daysUntilDue <= 1 || 
    (entry.item.impact >= 4 && entry.daysUntilDue <= 3) ||
    entry.score > 85
  );
}

export function summarize(items: readonly LifeRecord[], today = localDay()): PlanSummary {
  return items.reduce<PlanSummary>((summary, item) => {
    summary.total += 1;
    summary.effort += item.status === "done" ? 0 : item.effort;
    summary.completed += item.status === "done" ? 1 : 0;
    const days = daysBetween(today, item.dueDate);
    summary.overdue += item.status !== "done" && days < 0 ? 1 : 0;
    summary.dueSoon += item.status !== "done" && days >= 0 && days <= 7 ? 1 : 0;
    summary.byCategory[item.category] = (summary.byCategory[item.category] ?? 0) + 1;
    return summary;
  }, { total: 0, completed: 0, overdue: 0, dueSoon: 0, effort: 0, byCategory: {} });
}

export function suggestDailyLoad(items: readonly LifeRecord[], minutesPerDay: number, today = localDay()) {
  const capacity = Math.max(1, minutesPerDay);
  const days = Array.from({ length: 7 }, (_, offset) => ({
    date: new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10),
    used: 0,
    entries: [] as PlanEntry[],
  }));

  const planned = buildPlan(items, today);
  
  for (const entry of planned) {
    const dueDayIndex = entry.daysUntilDue;
    if (dueDayIndex >= 0 && dueDayIndex < 7) {
      const dueDay = days[dueDayIndex];
      if (dueDay.used + entry.item.effort <= capacity) {
        dueDay.entries.push(entry);
        dueDay.used += entry.item.effort;
        continue;
      }
    }

    const candidates = days.filter((_, index) => {
      if (entry.daysUntilDue < 0) return true;
      return index <= Math.min(6, entry.daysUntilDue);
    });

    const target = candidates.sort((a, b) => {
      if (entry.isCritical || entry.daysUntilDue < 0) {
        return 0;
      }
      return a.used - b.used;
    }).find(day => day.used + entry.item.effort <= capacity);

    if (target) {
      target.entries.push(entry);
      target.used += entry.item.effort;
    } else {
      const leastLoaded = days.sort((a, b) => a.used - b.used)[0];
      if (leastLoaded) {
        leastLoaded.entries.push(entry);
        leastLoaded.used += entry.item.effort;
      }
    }
  }

  return days.map((day) => ({ ...day, overloaded: day.used > capacity }));
}