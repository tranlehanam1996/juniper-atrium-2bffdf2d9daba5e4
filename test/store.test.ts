import { describe, expect, it, beforeEach, vi } from "vitest";
import { RecordStore } from "../src/core/store";
import type { LifeRecord } from "../src/types";

const makeRecord = (overrides: Partial<LifeRecord> = {}): LifeRecord => ({
  id: "one",
  title: "Example",
  category: "Health",
  dueDate: "2026-08-20",
  effort: 30,
  impact: 3,
  status: "planned",
  notes: "",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  ...overrides,
});

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("record store recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  it("uses the fallback when storage is empty", () => {
    const store = new RecordStore("key", [makeRecord()]);
    expect(store.all()).toHaveLength(1);
  });

  it("recovers a valid versioned envelope", () => {
    const record = makeRecord();
    localStorage.setItem("key", JSON.stringify({ version: 1, records: [record], savedAt: "2026-08-01T00:00:00Z" }));
    const store = new RecordStore("key", []);
    expect(store.all()[0]?.id).toBe("one");
  });

  it("rejects an envelope whose records contain a non-object entry", () => {
    localStorage.setItem("key", JSON.stringify({ version: 1, records: [null], savedAt: "2026-08-01T00:00:00Z" }));
    const store = new RecordStore("key", []);
    expect(store.all()).toHaveLength(0);
    expect(localStorage.getItem("key")).toBeNull();
  });

  it("rejects an envelope containing an invalid record", () => {
    localStorage.setItem("key", JSON.stringify({ version: 1, records: [{ ...makeRecord(), impact: 9 }], savedAt: "2026-08-01T00:00:00Z" }));
    const store = new RecordStore("key", [makeRecord({ id: "fallback" })]);
    expect(store.all()[0]?.id).toBe("fallback");
    expect(localStorage.getItem("key")).toBeNull();
  });

  it("rejects an envelope containing duplicate record ids", () => {
    const record = makeRecord();
    localStorage.setItem("key", JSON.stringify({ version: 1, records: [record, record], savedAt: "2026-08-01T00:00:00Z" }));
    const store = new RecordStore("key", []);
    expect(store.all()).toHaveLength(0);
    expect(localStorage.getItem("key")).toBeNull();
  });
});
