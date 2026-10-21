import { execFileSync } from 'node:child_process';
import { freemem, platform } from 'node:os';

/** Fresh, bounded OS observation, not a hard allocation guarantee.
 * Darwin's kern.memorystatus_level is the kernel's available-memory percentage
 * (also displayed by memory_pressure -Q), unlike os.freemem's empty-page count.
 * Only normal pressure (1) is accepted; warning/critical/unknown refuse.
 * Keep one percentage point out of the estimate for whole-percent rounding.
 * No shell, cache, fallback, pressure simulation or memory allocation command.
 */
export const readSystemAvailableMemory = (): number => {
  if (platform() !== 'darwin') return freemem();
  try {
    const text = execFileSync('/usr/sbin/sysctl', [
      '-n', 'hw.memsize', 'kern.memorystatus_level', 'kern.memorystatus_vm_pressure_level',
    ], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!/^\d+\n\d+\n1\n?$/.test(text)) return NaN;
    const [totalBytes, percent] = text.trim().split('\n').map(Number);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0
      || !Number.isSafeInteger(percent) || percent < 0 || percent > 100) return NaN;
    return Math.floor(totalBytes / 100 * Math.max(0, percent - 1));
  } catch { return NaN; }
};
