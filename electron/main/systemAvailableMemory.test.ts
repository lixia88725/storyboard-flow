import { expect, test, vi, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import * as os from 'node:os';
import { readSystemAvailableMemory } from './systemAvailableMemory';
import { createControlledMemoryBudget } from './controlledMemory';
import { MAIN_MEMORY_BUDGET_BYTES, MAIN_MEMORY_PRESSURE } from './memoryPolicy';

vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>() }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>() }));

afterEach(() => vi.restoreAllMocks());
const sample = (text: string) => {
  vi.spyOn(os, 'platform').mockReturnValue('darwin');
  return vi.spyOn(childProcess, 'execFileSync').mockReturnValue(text);
};
test('macOS uses fresh kernel available percentage, not empty pages, with bounded read-only query', () => {
  const query = sample('34359738368\n85\n1\n');
  vi.spyOn(os, 'freemem').mockReturnValue(1);
  // Whole-percent kernel reporting: subtract one percentage point conservatively.
  expect(readSystemAvailableMemory()).toBe(Math.floor(34359738368 * 84 / 100));
  query.mockReturnValue('34359738368\n50\n1\n');
  expect(readSystemAvailableMemory()).toBe(Math.floor(34359738368 * 49 / 100));
  expect(query).toHaveBeenCalledTimes(2);
  expect(query).toHaveBeenLastCalledWith('/usr/sbin/sysctl', ['-n', 'hw.memsize', 'kern.memorystatus_level', 'kern.memorystatus_vm_pressure_level'], expect.objectContaining({ timeout: 1000, maxBuffer: 1024, encoding: 'utf8' }));
});
test('missing, malformed, warning, critical and unknown kernel observations fail closed without free-page fallback', () => {
  const query = sample('');
  for (const text of ['', '34359738368\n101\n1\n', '0\n85\n1\n', '34359738368\n85\n2\n', '34359738368\n85\n4\n', '34359738368\n85\n3\n', '34359738368\n85\n1\nextra', 'NaN\n85\n1\n']) {
    query.mockReturnValue(text);
    expect(Number.isNaN(readSystemAvailableMemory())).toBe(true);
  }
  query.mockImplementation(() => { throw new Error('timeout or missing sysctl'); });
  expect(Number.isNaN(readSystemAvailableMemory())).toBe(true);
});
test('other platforms retain os.freemem behavior and do not invoke macOS tools', () => {
  vi.spyOn(os, 'platform').mockReturnValue('win32');
  vi.spyOn(os, 'freemem').mockReturnValue(1234);
  const query = vi.spyOn(childProcess, 'execFileSync');
  expect(readSystemAvailableMemory()).toBe(1234);
  expect(query).not.toHaveBeenCalled();
});
test('production pool and pressure ceilings still reject over-limit and unknown without changing existing backing bytes', () => {
  sample('34359738368\n85\n1\n');
  const budget = createControlledMemoryBudget(MAIN_MEMORY_BUDGET_BYTES, { policy: MAIN_MEMORY_PRESSURE });
  const kept = budget.allocate(8); kept.fill(42);
  expect(() => budget.reserve(MAIN_MEMORY_BUDGET_BYTES)).toThrow(/RAM_ADMISSION/);
  expect([...kept]).toEqual(Array(8).fill(42));
  expect(budget.usage().usedBytes).toBe(8);
  vi.spyOn(childProcess, 'execFileSync').mockReturnValue('unknown');
  expect(() => budget.reserve(1)).toThrow(/RAM_ADMISSION/);
  expect([...kept]).toEqual(Array(8).fill(42));
});
