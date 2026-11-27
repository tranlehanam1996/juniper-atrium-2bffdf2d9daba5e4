import type { LifeRecord } from "../types";

interface StoreEnvelope { version: 1; records: LifeRecord[]; savedAt: string }
type Listener = (records: readonly LifeRecord[]) => void;

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

function isLifeRecord(value: unknown): value is LifeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    record[key] = source[key];
  }
  return (
    isNonEmptyString(record.id) &&
    (record.id as string).trim().length <= MAX_ID_LENGTH &&
    isNonEmptyString(record.title) &&
    isNonEmptyString(record.category) &&
    typeof record.dueDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate as string) &&
    isCalendarDay(record.dueDate as string) &&
    typeof record.effort === "number" &&
    Number.isFinite(record.effort as number) &&
    (record.effort as number) >= 1 &&
    (record.effort as number) <= 480 &&
    typeof record.impact === "number" &&
    Number.isInteger(record.impact as number) &&
    (record.impact as number) >= 1 &&
    (record.impact as number) <= 5 &&
    (record.status === "planned" || record.status === "active" || record.status === "done") &&
    typeof record.notes === "string" &&
    typeof record.createdAt === "string" &&
    isTimestamp(record.createdAt as string) &&
    typeof record.updatedAt === "string" &&
    isTimestamp(record.updatedAt as string) &&
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
  const source = value as Record<string, unknown>;
  const envelope = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    envelope[key] = source[key];
  }
  if (envelope.version !== 1) return false;
  if (!Array.isArray(envelope.records)) return false;
  if (typeof envelope.savedAt !== "string" || !isTimestamp(envelope.savedAt as string)) return false;
  return (envelope.records as unknown[]).every(isLifeRecord);
}

export class RecordStore {
  private readonly listeners = new Set<Listener>();
  private records: LifeRecord[];

  constructor(private readonly key: string, initial: readonly LifeRecord[] = []) {
    const safeInitial = Array.isArray(initial) ? initial : [];
    const normalizedInitial = safeInitial
      .filter(isLifeRecord)
      .map((record) => ({ ...record, id: record.id.trim() }))
      .filter((record, index, records) => records.findIndex((candidate) => candidate.id === record.id) === index);
    this.records = this.read(normalizedInitial);
  }

  all(): readonly LifeRecord[] { return this.records.map((item) => ({ ...item })); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.all());
    } catch {
      // Keep subscriptions usable even if a listener throws.
    }
    return () => this.listeners.delete(listener);
  }

  upsert(record: LifeRecord): void {
    if (!record || typeof record !== "object" || Array.isArray(record)) return;
    const normalized = { ...record, id: typeof record.id === "string" ? record.id.trim() : record.id };
    if (!isLifeRecord(normalized)) return;
    const at = this.records.findIndex((item) => item.id === normalized.id);
    if (at >= 0) {
      this.records[at] = normalized;
      this.records = this.records.filter((item, index) => item.id !== normalized.id || index === at);
    } else {
      this.records.push(normalized);
    }
    this.commit();
  }

  remove(id: string): void {
    if (typeof id !== "string") return;
    const target = id.trim();
    if (!target) return;
    this.records = this.records.filter((item) => item.id !== target);
    this.commit();
  }

  replace(records: readonly LifeRecord[]): void {
    if (!Array.isArray(records)) return;
    const safeRecords = records;
    const normalized = safeRecords
      .filter(isLifeRecord)
      .map((item) => ({ ...item, id: item.id.trim() }));
    this.records = normalized.filter((record, index, records) =>
      records.findIndex((candidate) => candidate.id === record.id) === index
    );
    this.commit();
  }

  private read(fallback: LifeRecord[]): LifeRecord[] {
    const safeFallback = Array.isArray(fallback) ? fallback : [];
    const normalizedFallback = safeFallback
      .filter(isLifeRecord)
      .map((record) => ({
        ...record,
        id: typeof record?.id === "string" ? record.id.trim() : record?.id,
      }))
      .filter((record, index, records) => {
        const id = typeof record?.id === "string" ? record.id.trim() : null;
        if (id === null || id === "") return false;
        return (
          records.findIndex((candidate) => {
            const candidateId = typeof candidate?.id === "string" ? candidate.id.trim() : null;
            return candidateId === id;
          }) === index
        );
      });

    let raw: string | null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      return normalizedFallback;
    }
    if (raw === null) return normalizedFallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.replace(/^\uFEFF+/, "")) as unknown;
    } catch {
      try {
        localStorage.removeItem(this.key);
      } catch {
        // Ignore storage cleanup failures.
      }
      return normalizedFallback;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      try {
        localStorage.removeItem(this.key);
      } catch {
        // Ignore storage cleanup failures.
      }
      return normalizedFallback;
    }
    const parsedObject = parsed as Record<string, unknown>;
    const envelope = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(parsedObject)) {
      envelope[key] = parsedObject[key];
    }
    if (!isStoreEnvelope(envelope)) {
      try {
        localStorage.removeItem(this.key);
      } catch {
        // Ignore storage cleanup failures.
      }
      return normalizedFallback;
    }
    const storedRecords = envelope.records as LifeRecord[];
    const trimmedIds = storedRecords.map((record) => record.id.trim());
    if (
      trimmedIds.every((id) => id !== "" && id.length <= MAX_ID_LENGTH) &&
      new Set(trimmedIds).size === trimmedIds.length
    ) {
      return storedRecords.map((record, index) => ({ ...record, id: trimmedIds[index] }));
    }
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Ignore storage cleanup failures.
    }
    return normalizedFallback;
  }

  private commit(): void {
    const envelope: StoreEnvelope = { version: 1, records: this.records, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(this.key, JSON.stringify(envelope));
    } catch {
      // Keep in-memory state usable even when persistence is unavailable.
    }
    for (const listener of this.listeners) {
      try {
        listener(this.all());
      } catch {
        // Ignore listener failures so persistence notifications continue.
      }
    }
  }
}
