"""Read-only Vitest assertion preservation check; Python 3.9+, stdlib only.

Exit 0: originals preserved and failed assertion multiset unchanged;
if identity files are supplied, their input maps must also match.
Exit 1: comparison differs. Exit 2: invalid/unreadable input.
This compares evidence, not child exit codes or product acceptance. The before
report must be an independently established complete baseline; two incomplete
reports cannot establish canonical coverage. Suite paths are never opened.

Optional paired --before-identity/--after-identity JSON objects contain
reportSha256 (SHA256 of that exact report's bytes) and inputs (a nonempty map
of agreed source/build/config/environment identity labels to SHA256 values).
These snapshots must come from inspectable run records covering all relevant
inputs. This tool checks their binding/equality, not their provenance or scope,
and does not rehash source files. Omitted identities mean version NOT VERIFIED.
Neither an input hash nor a fixtureReady boolean proves real fixture state:
use inspectable setup/readback from the same instance/operation/version and the
existing acceptance matrix for required joint observations. No product runs.
"""
import argparse
import hashlib
from collections import Counter
import json
from pathlib import Path
import sys

STATUSES = {'passed', 'failed', 'pending', 'skipped', 'todo', 'disabled'}


def assertions(report, root=None):
    if not isinstance(report, dict) or not isinstance(report.get('testResults'), list):
        raise ValueError('report must contain a testResults list')
    cases = Counter()
    for suite in report['testResults']:
        if not isinstance(suite, dict) or not isinstance(suite.get('assertionResults'), list):
            raise ValueError('suite must contain an assertionResults list')
        name = suite['name']
        if not isinstance(name, str) or not name:
            raise ValueError('missing suite name')
        if root is not None:
            # Lexical mapping only: reading report paths must not read test files.
            name = str(Path(name).relative_to(Path(root)))
        if not suite['assertionResults']:
            raise ValueError('zero collected assertions in ' + name)
        for case in suite['assertionResults']:
            if not isinstance(case, dict):
                raise ValueError('assertion must be an object')
            full_name, status = case['fullName'], case['status']
            if not isinstance(full_name, str) or not full_name or status not in STATUSES:
                raise ValueError('invalid fullName/status')
            cases[(name, full_name, status)] += 1
    if not cases:
        raise ValueError('empty assertion report is not evidence')
    expected = {
        'numTotalTests': sum(cases.values()),
        'numPassedTests': sum(n for (_, _, s), n in cases.items() if s == 'passed'),
        'numFailedTests': sum(n for (_, _, s), n in cases.items() if s == 'failed'),
    }
    for field, count in expected.items():
        if field in report and report[field] != count:
            raise ValueError('inconsistent ' + field)
    return cases


def rows(counter):
    return [{'file': f, 'fullName': n, 'status': s, 'count': count}
            for (f, n, s), count in sorted(counter.items())]


def identity_inputs(path, report_bytes):
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('reportSha256') != hashlib.sha256(report_bytes).hexdigest():
        raise ValueError('identity is not bound to report: ' + str(path))
    inputs = value.get('inputs')
    if not isinstance(inputs, dict) or not inputs:
        raise ValueError('identity inputs must be a nonempty SHA256 map')
    for label, digest in inputs.items():
        if (not isinstance(label, str) or not label.strip() or
                not isinstance(digest, str) or len(digest) != 64 or
                any(c not in '0123456789abcdef' for c in digest)):
            raise ValueError('invalid identity input label/SHA256')
    return inputs


def compare(before, after, before_root=None, after_root=None):
    previous = assertions(before, before_root)
    current = assertions(after, after_root)
    # Counter rich ordering exists only in Python 3.10+. Subtraction works in 3.9.
    missing = previous - current
    added = current - previous
    old_failures = Counter({key: n for key, n in previous.items() if key[2] == 'failed'})
    new_failures = Counter({key: n for key, n in current.items() if key[2] == 'failed'})
    return {'preserved': not missing, 'failuresUnchanged': old_failures == new_failures,
            'beforeAssertions': sum(previous.values()), 'afterAssertions': sum(current.values()),
            'missing': rows(missing), 'added': rows(added),
            'beforeFailures': rows(old_failures), 'afterFailures': rows(new_failures)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--before-root')
    parser.add_argument('--after-root')
    parser.add_argument('--before-identity', type=Path)
    parser.add_argument('--after-identity', type=Path)
    args = parser.parse_args()
    try:
        before_bytes, after_bytes = args.before.read_bytes(), args.after.read_bytes()
        result = compare(json.loads(before_bytes), json.loads(after_bytes),
                         args.before_root, args.after_root)
        if bool(args.before_identity) != bool(args.after_identity):
            raise ValueError('both identity files are required together')
        result['identityUnchanged'] = None
        if args.before_identity:
            previous = identity_inputs(args.before_identity, before_bytes)
            current = identity_inputs(args.after_identity, after_bytes)
            result['changedInputs'] = sorted(key for key in previous.keys() | current.keys()
                                             if previous.get(key) != current.get(key))
            result['identityUnchanged'] = not result['changedInputs']
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if (result['preserved'] and result['failuresUnchanged'] and
                 result['identityUnchanged'] is not False) else 1


if __name__ == '__main__':
    sys.exit(main())
