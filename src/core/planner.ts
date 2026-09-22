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

  // Category-based inherent urgency weighting
  // Health is treated as highest priority, Grooming/Supplies as baseline
  if (item.category === "Health") {
    score += 10;
    reasons.push("high-priority category");
  } else if (item.category === "Training") {
    score += 4;
    reasons.push("development category");
  }

  if (daysUntilDue < 0) {
    const overdueDays = Math.abs(daysUntilDue);
    // Base overdue boost + linear growth
    score += 55 + Math.min(overdueDays, 14) * 3;
    
    // High-impact boost for overdue items to prevent they being drowned by small tasks
    if (item.impact >= 4) {
      score += 10;
      reasons.push("high-impact overdue");
    }

    if (overdueDays > 7) {
      // Stagnation penalty: items left too long become critical to prevent permanent neglect
      score += 25 + (overdueDays > 14 ? 15 : 0);
      reasons.push(`critical: ${overdueDays} day(s) overdue`);
      isCritical = true;
    } else {
      reasons.push(`${overdueDays} day(s) overdue`);
    }

    // Decay: Extremely old items eventually lose priority to allow new urgent work to surface
    if (overdueDays > 30) {
      const decay = Math.min(overdueDays - 30, 30) * 2;
      score -= decay;
      if (decay > 20) reasons.push("priority decayed (stale)");
    }
  } else if (daysUntilDue === 0) {
    score += 45;
    reasons.push("due today");
  } else if (daysUntilDue <= 3) {
    score += 30 - daysUntilDue * 6;
    reasons.push(`due very soon`);
    
    // High-impact urgency boost: Accelerate high impact items as they near the deadline
    if (item.impact >= 4 && daysUntilDue <= 2) {
      score += 15;
      reasons.push("high-impact urgency");
    }
  } else if (daysUntilDue <= 7) {
    score += 20 - daysUntilDue * 2;
    reasons.push(`due in ${daysUntilDue} day(s)`);
  }

  // Refined effort penalty: lower impact items are penalized more by effort
  // High impact items (4-5) resist the effort penalty more effectively
  // Medium impact items (3) get a slightly reduced penalty
  const effortWeight = item.impact >= 4 ? 0.04 : (item.impact === 3 ? 0.05 : 0.06);
  const effortPenalty = Math.min(item.effort * effortWeight, 12);
  score -= effortPenalty;

  if (item.status === "active") {
    // Reduced boost from 8 to 5 to avoid blocking high-impact new tasks
    score += 5;
    reasons.push("already in progress");
  }
  if (item.recurrence && item.recurrence !== "none") {
    // Habits get a slightly higher priority to keep the routine consistent
    score += 6;
    reasons.push("recurring habit");
  }
  if (item.pinned) {
    score += 15;
    reasons.push("manually pinned");
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
    (entry.daysUntilDue <= 0 && entry.score > 60) || 
    (entry.item.impact >= 4 && entry.daysUntilDue <= 2) ||
    entry.score > 100
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
  const softCapacity = capacity * 0.8;
  const days = Array.from({ length: 7 }, (_, offset) => ({
    date: new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10),
    used: 0,
    entries: [] as PlanEntry[],
  }));

  const planned = buildPlan(items, today);
  
  for (const entry of planned) {
    const dueDayIndex = entry.daysUntilDue;
    
    // Strategy 1: Due within the week - try the due day first within soft capacity
    if (dueDayIndex >= 0 && dueDayIndex < 7) {
      const dueDay = days[dueDayIndex];
      if (dueDay.used + entry.item.effort <= softCapacity) {
        dueDay.entries.push(entry);
        dueDay.used += entry.item.effort;
        continue;
      }
    }

    // Strategy 2: Critical items - place in the earliest possible slot within hard capacity
    if (entry.isCritical) {
      const earliest = days.find(day => day.used + entry.item.effort <= capacity);
      if (earliest) {
        earliest.entries.push(entry);
        earliest.used += entry.item.effort;
        continue;
      }
    }

    // Strategy 3: Overdue items (non-critical) - place as early as possible within hard capacity
    if (dueDayIndex < 0) {
      const earliest = days.find(day => day.used + entry.item.effort <= capacity);
      if (earliest) {
        earliest.entries.push(entry);
        earliest.used += entry.item.effort;
        continue;
      }
    }

    // Strategy 4: General distribution - balance across available candidates
    const candidates = days.filter((_, index) => {
      if (entry.daysUntilDue < 0) return true;
      return index <= Math.min(6, entry.daysUntilDue);
    });

    // Try to find the least loaded candidate that still fits within hard capacity
    const target = candidates
      .sort((a, b) => a.used - b.used)
      .find(day => day.used + entry.item.effort <= capacity);

    if (target) {
      target.entries.push(entry);
      target.used += entry.item.effort;
    } else {
      // Fallback: force into the absolute least loaded day of the week
      const absoluteLeast = days.reduce((prev, curr) => (curr.used < prev.used ? curr : prev));
      absoluteLeast.entries.push(entry);
      absoluteLeast.used += entry.item.effort;
    }
  }

  return days.map((day) => ({ ...day, overloaded: day.used > capacity }));
}