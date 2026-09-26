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
  let isQuickWin = false;
  let isMilestone = false;

  // Category-based inherent urgency weighting
  if (item.category === "Health") {
    score += 15;
    reasons.push("critical care category");
  } else if (item.category === "Grooming") {
    score += 6;
    reasons.push("maintenance category");
  } else if (item.category === "Training") {
    score += 4;
    reasons.push("development category");
  }

  if (daysUntilDue < 0) {
    const overdueDays = Math.abs(daysUntilDue);
    score += 55 + Math.min(overdueDays, 14) * 3;
    
    if (item.impact >= 4) {
      score += 10;
      reasons.push("high-impact overdue");
    }

    if (overdueDays > 7) {
      score += 25 + (overdueDays > 14 ? 15 : 0);
      reasons.push(`critical: ${overdueDays} day(s) overdue`);
      isCritical = true;
    } else {
      reasons.push(`${overdueDays} day(s) overdue`);
    }

    if (overdueDays > 30) {
      // Refined decay: more aggressive for very stale items to prevent "overdue noise"
      const decay = Math.min(overdueDays - 30, 90) * 2.0;
      score -= decay;
      if (decay > 15) reasons.push("priority decayed (stale)");
    }
  } else if (daysUntilDue === 0) {
    score += 45;
    reasons.push("due today");
  } else if (daysUntilDue <= 3) {
    score += 30 - daysUntilDue * 6;
    reasons.push(`due very soon`);
    
    if (item.impact >= 4 && daysUntilDue <= 2) {
      score += 20;
      reasons.push("high-impact urgency");
    }
  } else if (daysUntilDue <= 7) {
    score += 20 - daysUntilDue * 2;
    reasons.push(`due in ${daysUntilDue} day(s)`);
  }

  // Weekend Bonus: Suggest tasks that fall on Saturday/Sunday (0=Sun, 6=Sat)
  const dueDateObj = new Date(`${item.dueDate}T00:00:00Z`);
  const dayOfWeek = dueDateObj.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    score += 5;
    reasons.push("weekend window");
  }

  // Near-term urgency multiplier for items due in 0-2 days
  if (daysUntilDue >= 0 && daysUntilDue <= 2) {
    const multiplier = 1 + (3 - daysUntilDue) * 0.05;
    score *= multiplier;
    if (multiplier > 1) reasons.push("near-term urgency");
  }

  // Effort penalty adjusted by category and impact
  let effortWeight = item.impact >= 4 ? 0.03 : (item.impact === 3 ? 0.05 : 0.07);
  if (item.category === "Health") effortWeight *= 0.7;
  if (item.category === "Supplies") effortWeight *= 1.2;

  const effortPenalty = Math.min(item.effort * effortWeight, 15);
  score -= effortPenalty;

  // High-effort High-impact balancing: ensure big important tasks aren't fully suppressed
  if (item.impact >= 5 && item.effort > 120) {
    score += 8;
    reasons.push("major milestone");
    isMilestone = true;
  }

  // Quick Win Bonus: Higher impact items with low effort get a stronger boost
  if (item.impact >= 4 && item.effort <= 15) {
    score += (item.impact === 5 ? 18 : 12);
    reasons.push("quick win");
    isQuickWin = true;
  }

  if (item.status === "active") {
    score += 5;
    reasons.push("already in progress");
  }
  if (item.recurrence && item.recurrence !== "none") {
    score += 6;
    reasons.push("recurring habit");
    if (item.recurrence === "daily") {
      score += 4;
      reasons.push("daily routine");
    }
  }
  if (item.pinned) {
    score += 15;
    reasons.push("manually pinned");
  }
  if (item.status === "done") score = -1;
  if (reasons.length === 0) reasons.push("ranked by impact and effort");
  return { item, score: Math.round(score * 10) / 10, reasons, daysUntilDue, isCritical, isQuickWin, isMilestone };
}

export function buildPlan(items: readonly LifeRecord[], today = localDay(), query = ""): PlanEntry[] {
  const filtered = query
    ? items.filter(i => 
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.notes.toLowerCase().includes(query.toLowerCase()) ||
        i.category.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  return filtered
    .map((item) => priorityFor(item, today))
    .filter((entry) => entry.item.status !== "done")
    .sort((a, b) => {
      if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
      return b.score - a.score || a.item.dueDate.localeCompare(b.item.dueDate);
    });
}

export function focusedPlan(items: readonly LifeRecord[], today = localDay(), query = ""): PlanEntry[] {
  const plan = buildPlan(items, today, query);
  return plan.filter(entry => 
    entry.item.pinned || 
    entry.isCritical ||
    (entry.daysUntilDue <= 0 && entry.score > 85) || 
    (entry.item.impact >= 4 && entry.daysUntilDue <= 3) ||
    (entry.item.impact >= 3 && entry.item.effort <= 20 && entry.daysUntilDue <= 7) ||
    entry.score > 120
  );
}

export function lowEnergyPlan(items: readonly LifeRecord[], today = localDay(), query = ""): PlanEntry[] {
  const plan = buildPlan(items, today, query);
  return plan.filter(entry => 
    entry.item.effort <= 30 && 
    (entry.score > 60 || entry.daysUntilDue <= 0)
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
  
  // Sort planned entries: prioritize high effort items first for placement
  const sortedForLoad = [...planned].sort((a, b) => b.item.effort - a.item.effort);

  for (const entry of sortedForLoad) {
    const dueDayIndex = entry.daysUntilDue;
    
    // Strategy 1: Try to fit it on its due date if it's within the week and under soft capacity
    if (dueDayIndex >= 0 && dueDayIndex < 7) {
      const dueDay = days[dueDayIndex];
      if (dueDay.used + entry.item.effort <= softCapacity) {
        dueDay.entries.push(entry);
        dueDay.used += entry.item.effort;
        continue;
      }
    }

    // Strategy 2: Critical, Overdue, or High-Impact items get priority across any available slot under full capacity
    if (entry.isCritical || dueDayIndex < 0 || entry.item.impact >= 5) {
      const earliest = days.find(day => day.used + entry.item.effort <= capacity);
      if (earliest) {
        earliest.entries.push(entry);
        earliest.used += entry.item.effort;
        continue;
      }
    }

    // Strategy 3: For non-critical future items, try any day up to the due date that has space
    const candidates = days.filter((_, index) => {
      if (dueDayIndex < 0) return true;
      return index <= Math.min(6, dueDayIndex);
    });

    const target = candidates
      .sort((a, b) => a.used - b.used)
      .find(day => day.used + entry.item.effort <= capacity);

    if (target) {
      target.entries.push(entry);
      target.used += entry.item.effort;
    } else {
      // Strategy 4: Spillover - prioritize the least loaded day, even if it slightly overloads
      const absoluteLeast = days.reduce((prev, curr) => (curr.used < prev.used ? curr : prev));
      absoluteLeast.entries.push(entry);
      absoluteLeast.used += entry.item.effort;
    }
  }

  return days.map((day) => ({ ...day, overloaded: day.used > capacity }));
}
