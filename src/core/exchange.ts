import type { ItemStatus, LifeRecord, ThemeConfig, RecurrenceType } from '../types';

export function exportJson(records: readonly LifeRecord[]): string {
  return JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), records }, null, 2);
}

const STATUSES: readonly ItemStatus[] = ['planned', 'active', 'done'];
const RECURRENCES: readonly RecurrenceType[] = ['none', 'daily', 'weekly', 'monthly'];

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const canonical = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  return parsed.toISOString() === canonical;
}

function decodeRecord(value: unknown, index: number, theme: ThemeConfig): LifeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Record ${index + 1} is not an object.`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.trim().length < 1 || raw.id.trim().length > 120) {
    throw new Error(`Record ${index + 1} has an invalid id.`);
  }
  if (typeof raw.title !== 'string') {
    throw new Error(`Record ${index + 1} has an invalid title.`);
  }
  const title = raw.title.trim();
  if (title.length < 1 || title.length > 100) {
    throw new Error(`Record ${index + 1} has an invalid title.`);
  }
  if (typeof raw.category !== 'string' || !theme.categories.includes(raw.category)) {
    throw new Error(`Record ${index + 1} has an unknown category.`);
  }
  if (!isCalendarDay(raw.dueDate)) throw new Error(`Record ${index + 1} has an invalid due date.`);
  if (typeof raw.effort !== 'number' || !Number.isFinite(raw.effort) || raw.effort < 1 || raw.effort > 480) {
    throw new Error(`Record ${index + 1} has invalid effort.`);
  }
  if (typeof raw.impact !== 'number' || !Number.isInteger(raw.impact) || raw.impact < 1 || raw.impact > 5) {
    throw new Error(`Record ${index + 1} has invalid impact.`);
  }
  if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status as ItemStatus)) {
    throw new Error(`Record ${index + 1} has an invalid status.`);
  }
  if (typeof raw.notes !== 'string' || raw.notes.length > 600) {
    throw new Error(`Record ${index + 1} has invalid notes.`);
  }
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) {
    throw new Error(`Record ${index + 1} has invalid timestamps.`);
  }
  if (raw.recurrence !== undefined && (typeof raw.recurrence !== 'string' || !RECURRENCES.includes(raw.recurrence as RecurrenceType))) {
    throw new Error(`Record ${index + 1} has an invalid recurrence value.`);
  }
  if (raw.pinned !== undefined && typeof raw.pinned !== 'boolean') {
    throw new Error(`Record ${index + 1} has an invalid pinned value.`);
  }

  return {
    id: raw.id.trim(),
    title,
    category: raw.category,
    dueDate: raw.dueDate,
    effort: raw.effort,
    impact: raw.impact,
    status: raw.status as ItemStatus,
    notes: raw.notes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    recurrence: raw.recurrence as RecurrenceType | undefined,
    pinned: raw.pinned as boolean | undefined,
  };
}

export function importJson(source: string, theme: ThemeConfig): LifeRecord[] {
  const parsedUnknown = JSON.parse(source) as unknown;
  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    throw new Error('Unsupported backup format.');
  }
  const parsed = parsedUnknown as { schema?: unknown; records?: unknown };
  if (parsed.schema !== 1 || !Array.isArray(parsed.records)) throw new Error('Unsupported backup format.');
  const ids = new Set<string>();
  return parsed.records.map((value, index) => {
    const item = decodeRecord(value, index, theme);
    if (ids.has(item.id)) throw new Error(`Record ${index + 1} has a duplicate id.`);
    ids.add(item.id);
    return item;
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      current.push(field); field = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      current.push(field); field = '';
      if (current.some(v => v.trim() !== '')) rows.push(current);
      current = [];
    } else {
      field += char;
    }
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    if (current.some(v => v.trim() !== '')) rows.push(current);
  }
  return rows;
}

const CSV_FIELDS = ['id', 'title', 'category', 'dueDate', 'effort', 'impact', 'status', 'notes', 'recurrence', 'pinned'] as const;

export function importCsv(source: string, theme: ThemeConfig): LifeRecord[] {
  const rows = parseCsv(source);
  if (rows.length === 0) throw new Error('Unsupported backup format: empty CSV.');
  if (rows[0].join(',') !== CSV_FIELDS.join(',')) {
    throw new Error('Unsupported backup format: invalid CSV header.');
  }
  const ids = new Set<string>();
  const parsed: LifeRecord[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length !== CSV_FIELDS.length) throw new Error(`Record ${i} has an invalid column count.`);
    const raw = Object.fromEntries(CSV_FIELDS.map((field, index) => [field, row[index]]));
    const id = (raw.id ?? '').trim();
    const title = (raw.title ?? '').trim();
    const category = (raw.category ?? '').trim();
    const dueDate = (raw.dueDate ?? '').trim();
    const effort = Number(raw.effort);
    const impact = Number(raw.impact);
    const status = (raw.status ?? '').trim() as ItemStatus;
    const notes = raw.notes ?? '';
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    if (id.length < 1 || id.length > 120) throw new Error(`Record ${i} has an invalid id.`);
    if (title.length < 1 || title.length > 100) throw new Error(`Record ${i} has an invalid title.`);
    if (!theme.categories.includes(category)) throw new Error(`Record ${i} has an unknown category.`);
    if (!isCalendarDay(dueDate)) throw new Error(`Record ${i} has an invalid due date.`);
    if (!Number.isFinite(effort) || effort < 1 || effort > 480) throw new Error(`Record ${i} has invalid effort.`);
    if (!Number.isInteger(impact) || impact < 1 || impact > 5) throw new Error(`Record ${i} has invalid impact.`);
    if (!STATUSES.includes(status)) throw new Error(`Record ${i} has an invalid status.`);
    if (notes.length > 600) throw new Error(`Record ${i} has invalid notes.`);
    let recurrence: RecurrenceType | undefined;
    const recurrenceRaw = (raw.recurrence ?? '').trim();
    if (recurrenceRaw !== '') {
      if (!RECURRENCES.includes(recurrenceRaw as RecurrenceType)) throw new Error(`Record ${i} has an invalid recurrence value.`);
      recurrence = recurrenceRaw as RecurrenceType;
    }
    let pinned: boolean | undefined;
    const pinnedRaw = (raw.pinned ?? '').trim();
    if (pinnedRaw !== '') {
      if (pinnedRaw !== 'true' && pinnedRaw !== 'false') throw new Error(`Record ${i} has an invalid pinned value.`);
      pinned = pinnedRaw === 'true';
    }
    if (ids.has(id)) throw new Error(`Record ${i} has a duplicate id.`);
    ids.add(id);
    parsed.push({
      id,
      title,
      category,
      dueDate,
      effort,
      impact,
      status,
      notes,
      createdAt,
      updatedAt,
      recurrence,
      pinned,
    });
  }
  return parsed;
}

function csvCell(value: unknown): string {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}

export function exportCsv(records: readonly LifeRecord[]): string {
  const fields: (keyof LifeRecord)[] = ['id', 'title', 'category', 'dueDate', 'effort', 'impact', 'status', 'notes', 'recurrence', 'pinned'];
  return [fields.join(','), ...records.map((item) => fields.map((field) => csvCell(item[field])).join(','))].join('\n');
}

export function download(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  anchor.click();
  URL.revokeObjectURL(url);
}