"""Read-only Vitest assertion preservation check; Python 3.9+, stdlib only.

Exit 0: originals preserved and failed assertion multiset unchanged.
Exit 1: comparison differs. Exit 2: invalid/unreadable input.
This compares evidence, not child exit codes or product acceptance.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

STATUSES = {'passed', 'failed', 'pending', 'skipped', 'todo', 'disabled'}


def assertions(report, root=None):
    cases = Counter()
    for suite in report['testResults']:
        name = suite['name']
        if not isinstance(name, str) or not name:
            raise ValueError('missing suite name')
        if root is not None:
            # Lexical mapping only: reading report paths must not read test files.
            name = str(Path(name).relative_to(Path(root)))
        for case in suite['assertionResults']:
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
    args = parser.parse_args()
    try:
        result = compare(json.loads(args.before.read_text()), json.loads(args.after.read_text()),
                         args.before_root, args.after_root)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['preserved'] and result['failuresUnchanged'] else 1


if __name__ == '__main__':
    sys.exit(main())
