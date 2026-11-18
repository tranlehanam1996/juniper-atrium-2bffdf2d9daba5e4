import { describe, expect, it } from 'vitest';
import { importJson, importCsv, exportCsv } from '../src/core/exchange';
import { theme } from '../src/theme';
import type { LifeRecord } from '../src/types';

const item = (overrides: Partial<LifeRecord> = {}): LifeRecord => ({
  id: 'one', title: 'Example', category: theme.categories[0], dueDate: '2026-08-20', effort: 30,
  impact: 3, status: 'planned', notes: '', createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z', ...overrides,
});

const backup = (record: unknown): string => JSON.stringify({ schema: 1, records: [record] });

describe('hardened JSON import', () => {
  it('preserves recurrence values during import', () => {
    const record = { ...item(), recurrence: 'weekly' as LifeRecord['recurrence'] };
    expect(importJson(backup(record), theme)[0].recurrence).toBe('weekly');
  });

  it('rejects non-object backup documents', () => {
    expect(() => importJson('null', theme)).toThrow(/Unsupported backup format/);
    expect(() => importJson('[]', theme)).toThrow(/Unsupported backup format/);
    expect(() => importJson('42', theme)).toThrow(/Unsupported backup format/);
  });

  it('rejects backup documents without a records array', () => {
    expect(() => importJson(JSON.stringify({ schema: 1 }), theme)).toThrow(/Unsupported backup format/);
  });

  it('trims id padding before applying the length limit', () => {
    const paddedId = `${' '.repeat(10)}${'a'.repeat(115)}`;
    expect(importJson(backup({ ...item(), id: paddedId }), theme)[0].id).toBe('a'.repeat(115));
  });
});

describe('CSV export', () => {
  it('includes recurrence and pinned values', () => {
    const csv = exportCsv([item({ recurrence: 'weekly', pinned: true })]);
    expect(csv).toContain('weekly');
    expect(csv).toContain('true');
  });
});

describe('CSV import', () => {
  it('imports valid rows and skips blank rows', () => {
    const csv = [
      'id,title,category,dueDate,effort,impact,status,notes,recurrence,pinned',
      'one,Example,Health,2026-08-20,30,3,planned,,weekly,true',
      '',
      'two,Other,Health,2026-08-21,10,2,active,note,none,false',
    ].join('\n');
    const records = importCsv(csv, theme);
    expect(records).toHaveLength(2);
    expect(records[0].recurrence).toBe('weekly');
    expect(records[0].pinned).toBe(true);
    expect(records[1].notes).toBe('note');
  });

  it('handles lone carriage returns', () => {
    const csv = 'id,title,category,dueDate,effort,impact,status,notes,recurrence,pinned\rone,Example,Health,2026-08-20,30,3,planned,,none,';
    const records = importCsv(csv, theme);
    expect(records).toHaveLength(1);
  });
});
