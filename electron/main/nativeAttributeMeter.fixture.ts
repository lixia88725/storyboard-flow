import { execFileSync } from 'node:child_process';

/** Independent macOS read-only oracle for self-owned synthetic fixtures.
 * Does not import the production accounting code, copy/clear attributes, read
 * credentials, or claim filesystem block-allocation overhead is payload bytes.
 * Fixture names are controlled and cannot contain newlines.
 */
export const fixtureAttributeBytes = (file: string): number => {
  const names = execFileSync('/usr/bin/xattr', [file], { encoding: 'utf8' }).trim();
  if (!names) return 0;
  return names.split('\n').reduce((bytes, name) => {
    const hex = execFileSync('/usr/bin/xattr', ['-p', '-x', name, file], { encoding: 'utf8' }).replace(/\s/g, '');
    if (!/^(?:[a-fA-F0-9]{2})*$/.test(hex)) throw new Error('Independent fixture xattr encoding');
    return bytes + Buffer.byteLength(name) + Buffer.from(hex, 'hex').length;
  }, 0);
};
