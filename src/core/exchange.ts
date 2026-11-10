import type { LifeRecord, ItemStatus, RecurrenceType, ThemeConfig } from "../types";

const MAX_ID_LENGTH = 128;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isCalendarDay(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const date = new Date(parsed);
  const [, year, month, day, hour, minute, second] = match;
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
  );
}

function validateRecord(input: Partial<LifeRecord>, theme: ThemeConfig): LifeRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Unsupported backup format");
  }
  const record = input as Partial<LifeRecord>;

  if (typeof record.id !== "string") throw new Error("id must be a string");
  const id = record.id.trim();
  if (!id) throw new Error("id must not be empty");
  if (id.length > MAX_ID_LENGTH) throw new Error("id is too long");

  if (typeof record.title !== "string" || !record.title.trim()) {
    throw new Error(`${theme.itemLabel} needs a title.`);
  }
  if (typeof record.category !== "string" || !theme.categories.includes(record.category)) {
    throw new Error("Choose a valid category.");
  }
  if (
    typeof record.dueDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) ||
    !isCalendarDay(record.dueDate)
  ) {
    throw new Error("Choose a valid date.");
  }
  if (
    typeof record.effort !== "number" ||
    !Number.isFinite(record.effort) ||
    record.effort < 1 ||
    record.effort > 480
  ) {
    throw new Error("Effort must be a number between 1 and 480.");
  }
  if (
    typeof record.impact !== "number" ||
    !Number.isInteger(record.impact) ||
    record.impact < 1 ||
    record.impact > 5
  ) {
    throw new Error("Impact must be an integer between 1 and 5.");
  }
  if (record.status !== "planned" && record.status !== "active" && record.status !== "done") {
    throw new Error("status must be planned, active, or done.");
  }
  if (typeof record.notes !== "string") {
    throw new Error("notes must be a string.");
  }
  if (typeof record.createdAt !== "string" || !isTimestamp(record.createdAt)) {
    throw new Error("createdAt must be a valid timestamp.");
  }
  if (typeof record.updatedAt !== "string" || !isTimestamp(record.updatedAt)) {
    throw new Error("updatedAt must be a valid timestamp.");
  }
  if (record.pinned !== undefined && typeof record.pinned !== "boolean") {
    throw new Error("pinned must be a boolean.");
  }
  if (
    record.recurrence !== undefined &&
    record.recurrence !== "none" &&
    record.recurrence !== "daily" &&
    record.recurrence !== "weekly" &&
    record.recurrence !== "monthly"
  ) {
    throw new Error("recurrence must be none, daily, weekly, or monthly.");
  }

  return {
    id,
    title: record.title,
    category: record.category,
    dueDate: record.dueDate,
    effort: record.effort,
    impact: record.impact,
    status: record.status as ItemStatus,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pinned: record.pinned,
    recurrence: record.recurrence as RecurrenceType | undefined,
  };
}

export function importJson(text: string, theme: ThemeConfig): LifeRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Unsupported backup format");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Unsupported backup format");
  }
  const document = parsed as Record<string, unknown>;
  if (document.schema !== 1) {
    throw new Error("Unsupported backup format");
  }
  if (!Array.isArray(document.records)) {
    throw new Error("Unsupported backup format");
  }

  const records: LifeRecord[] = [];
  const ids = new Set<string>();
  for (const entry of document.records) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Unsupported backup format");
    }
    const normalized = validateRecord(entry as Partial<LifeRecord>, theme);
    if (ids.has(normalized.id)) {
      throw new Error("duplicate id");
    }
    ids.add(normalized.id);
    records.push(normalized);
  }
  return records;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
        continue;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (inQuotes) {
    throw new Error("unclosed quote");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function importCsv(text: string, theme: ThemeConfig): LifeRecord[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];
  const header = rows[0].map((value) => value.trim());
  if (new Set(header).size !== header.length) {
    throw new Error("duplicate column");
  }
  const records: LifeRecord[] = [];
  const ids = new Set<string>();
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.length === 1 && row[0].trim() === "") continue;
    const values: Record<string, string> = {};
    header.forEach((name, index) => {
      values[name] = (row[index] ?? "").trim();
    });
    const now = new Date().toISOString();
    const pinnedRaw = values.pinned;
    let pinned: boolean | undefined;
    if (pinnedRaw === "" || pinnedRaw === undefined) {
      pinned = undefined;
    } else if (pinnedRaw === "true" || pinnedRaw === "1") {
      pinned = true;
    } else if (pinnedRaw === "false" || pinnedRaw === "0") {
      pinned = false;
    } else {
      throw new Error("pinned must be a boolean.");
    }
    const partial: Partial<LifeRecord> = {
      id: values.id,
      title: values.title,
      category: values.category,
      dueDate: values.dueDate,
      effort: Number(values.effort),
      impact: Number(values.impact),
      status: values.status as ItemStatus,
      notes: values.notes,
      recurrence: (values.recurrence || "none") as RecurrenceType,
      pinned,
      createdAt: now,
      updatedAt: now,
    };
    const normalized = validateRecord(partial, theme);
    if (ids.has(normalized.id)) {
      throw new Error("duplicate id");
    }
    ids.add(normalized.id);
    records.push(normalized);
  }
  return records;
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportCsv(records: readonly LifeRecord[]): string {
  const header = ["id", "title", "category", "dueDate", "effort", "impact", "status", "notes", "recurrence", "pinned"];
  const lines = [header.join(",")];
  for (const record of records) {
    const row = [
      record.id,
      record.title,
      record.category,
      record.dueDate,
      record.effort,
      record.impact,
      record.status,
      record.notes,
      record.recurrence ?? "none",
      record.pinned ?? "",
    ].map(csvEscape);
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

export function exportJson(records: readonly LifeRecord[]): string {
  return JSON.stringify({ schema: 1, records }, null, 2);
}

export function download(content: string, filename: string, mimeType = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
