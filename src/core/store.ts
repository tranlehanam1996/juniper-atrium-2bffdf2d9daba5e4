import type { LifeRecord } from "../types";

interface StoreEnvelope { version: 1; records: LifeRecord[]; savedAt: string }
type Listener = (records: readonly LifeRecord[]) => void;

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

function isLifeRecord(value: unknown): value is LifeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.title) &&
    isNonEmptyString(record.category) &&
    typeof record.dueDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) &&
    isCalendarDay(record.dueDate) &&
    typeof record.effort === "number" &&
    Number.isFinite(record.effort) &&
    record.effort >= 1 &&
    record.effort <= 480 &&
    typeof record.impact === "number" &&
    Number.isInteger(record.impact) &&
    record.impact >= 1 &&
    record.impact <= 5 &&
    (record.status === "planned" || record.status === "active" || record.status === "done") &&
    typeof record.notes === "string" &&
    typeof record.createdAt === "string" &&
    isTimestamp(record.createdAt) &&
    typeof record.updatedAt === "string" &&
    isTimestamp(record.updatedAt) &&
    (record.pinned === undefined || typeof record.pinned === "boolean") &&
    (record.recurrence === undefined ||
      record.recurrence === "none" ||
      record.recurrence === "daily" ||
      record.recurrence === "weekly" ||
      record.recurrence === "monthly")
  );
}

function isStoreEnvelope(value: unknown): value is StoreEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.version !== 1) return false;
  if (!Array.isArray(envelope.records)) return false;
  if (typeof envelope.savedAt !== "string" || !isTimestamp(envelope.savedAt)) return false;
  return envelope.records.every(isLifeRecord);
}

export class RecordStore {
  private readonly listeners = new Set<Listener>();
  private records: LifeRecord[];

  constructor(private readonly key: string, initial: LifeRecord[]) {
    const safeInitial = Array.isArray(initial) ? initial : [];
    this.records = this.read(safeInitial.map((record) => ({
      ...record,
      id: typeof record?.id === "string" ? record.id.trim() : record?.id,
    })));
  }

  all(): readonly LifeRecord[] { return this.records.map((item) => ({ ...item })); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.all());
    return () => this.listeners.delete(listener);
  }

  upsert(record: LifeRecord): void {
    if (!record || typeof record !== "object" || Array.isArray(record)) return;
    const normalized = { ...record, id: typeof record.id === "string" ? record.id.trim() : record.id };
    const at = this.records.findIndex((item) => item.id === normalized.id);
    if (at >= 0) this.records[at] = normalized;
    else this.records.push(normalized);
    this.commit();
  }

  remove(id: string): void {
    const target = typeof id === "string" ? id.trim() : id;
    this.records = this.records.filter((item) => item.id !== target);
    this.commit();
  }

  replace(records: LifeRecord[]): void {
    const safeRecords = Array.isArray(records) ? records : [];
    this.records = safeRecords.map((item) => ({
      ...item,
      id: typeof item?.id === "string" ? item.id.trim() : item?.id,
    }));
    this.commit();
  }

  private read(fallback: LifeRecord[]): LifeRecord[] {
    const safeFallback = Array.isArray(fallback) ? fallback : [];
    const normalizedFallback = safeFallback.map((record) => ({
      ...record,
      id: typeof record?.id === "string" ? record.id.trim() : record?.id,
    }));
    const raw = localStorage.getItem(this.key);
    if (raw === null) return normalizedFallback;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isStoreEnvelope(parsed)) {
        const trimmedIds = parsed.records.map((record) => record.id.trim());
        if (new Set(trimmedIds).size === trimmedIds.length && trimmedIds.every((id) => id !== "")) {
          return parsed.records.map((record, index) => ({ ...record, id: trimmedIds[index] }));
        }
      }
    } catch {
      // Fall through to removal below.
    }
    localStorage.removeItem(this.key);
    return normalizedFallback;
  }

  private commit(): void {
    const envelope: StoreEnvelope = { version: 1, records: this.records, savedAt: new Date().toISOString() };
    localStorage.setItem(this.key, JSON.stringify(envelope));
    for (const listener of this.listeners) listener(this.all());
  }
}