import { createHash } from 'node:crypto';

// A partition identity is not a policy certificate or authority. Native still
// verifies the full source observations and actual destination on every request.
export const recoveryPolicyKey = (policy: any): string => {
  const expected = policy?.expected;
  if (!expected || Object.keys(expected).sort().join(',') !== 'flags,gid,mode,uid,xattrs'
    || !['uid', 'gid', 'mode', 'flags'].every(field => Number.isSafeInteger(expected[field]) && expected[field] >= 0)
    || expected.mode > 0o777 || expected.mode & 0o111 || expected.flags !== 0
    || !expected.xattrs || typeof expected.xattrs !== 'object' || Array.isArray(expected.xattrs)) throw new Error('Unsupported recovery partition policy');
  const attributes = Object.keys(expected.xattrs).sort().map(name => {
    const value = expected.xattrs[name];
    const decoded = Buffer.from(name, 'base64');
    if (!decoded.length || decoded.includes(0) || decoded.toString('base64') !== name
      || typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) throw new Error('Noncanonical recovery partition attributes');
    return [name, value];
  });
  // Fixed ASCII schema/field order and sorted canonical base64 pairs avoid
  // JS object integer-key ordering and Python JSON serialization differences.
  const core = ['swb.recovery-policy.v2', 'darwin', expected.uid, expected.gid, expected.mode, expected.flags, 'verified-absent', attributes];
  return createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex');
};

/** Restrict new content by ALL copied/reference contributors. This combines
 * Main-owned certificates; it never certifies a renderer's claimed policy. The
 * native adapter independently rebuilds the full intersection on every effect. */
export const intersectRecoveryPolicies = (policies: readonly any[]) => {
  if (!policies.length) throw new Error('Complete recovery contributors required');
  for (const policy of policies) {
    recoveryPolicyKey(policy);
    if (policy.schema !== 'swb.finite-source-policy' || policy.version !== 1 || !Array.isArray(policy.observed) || !policy.observed.length) throw new Error('Unknown recovery contributor certificate');
  }
  const expected = structuredClone(policies[0].expected);
  const attributes = (v: any) => JSON.stringify(Object.keys(v).sort().map(key => [key, v[key]]));
  for (const policy of policies.slice(1)) {
    const actual = policy.expected;
    if (['uid', 'gid', 'flags'].some(field => expected[field] !== actual[field]) || attributes(expected.xattrs) !== attributes(actual.xattrs)) throw new Error('Incompatible recovery contributor restrictions');
    expected.mode &= actual.mode;
  }
  const observations = new Map<string, any>();
  for (const policy of policies) for (const observation of policy.observed) observations.set(JSON.stringify(observation), structuredClone(observation));
  return { schema: 'swb.finite-source-policy', version: 1, expected, observed: [...observations.values()] };
};
