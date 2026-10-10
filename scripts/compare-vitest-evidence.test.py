"""Stdlib regressions: run with python3 scripts/compare-vitest-evidence.test.py."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from typing import Any
import unittest

SCRIPT = Path(__file__).with_name('compare-vitest-evidence.py')
spec = importlib.util.spec_from_file_location('evidence', SCRIPT)
assert spec is not None and spec.loader is not None
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def report(*statuses) -> dict[str, Any]:
    return {'testResults': [{'name': 'suite.test.ts', 'assertionResults': [
        {'fullName': 'same test', 'status': status} for status in statuses]}]}


class ComparisonTests(unittest.TestCase):
    def test_retains_duplicate_multiplicity(self):
        result = evidence.compare(report('passed', 'passed'), report('passed'))
        self.assertFalse(result['preserved'])
        self.assertEqual(result['missing'][0]['count'], 1)

    def test_allows_additions_not_removals(self):
        result = evidence.compare(report('passed'), report('passed', 'passed'))
        self.assertTrue(result['preserved'])
        self.assertEqual(result['added'][0]['count'], 1)

    def test_status_change_is_not_same_count(self):
        self.assertFalse(evidence.compare(report('failed'), report('passed'))['preserved'])

    def test_added_failure_is_reported_separately(self):
        result = evidence.compare(report('passed'), report('passed', 'failed'))
        self.assertTrue(result['preserved'])
        self.assertFalse(result['failuresUnchanged'])

    def test_same_name_in_other_file_is_not_equivalent(self):
        other = report('passed'); other['testResults'][0]['name'] = 'other.test.ts'
        self.assertFalse(evidence.compare(report('passed'), other)['preserved'])

    def test_explicit_root_mapping(self):
        before = report('passed'); before['testResults'][0]['name'] = '/before/suite.test.ts'
        after = report('passed'); after['testResults'][0]['name'] = '/after/suite.test.ts'
        self.assertTrue(evidence.compare(before, after, '/before', '/after')['preserved'])
        with self.assertRaises(ValueError):
            evidence.compare(before, after, '/wrong', '/after')

    def test_empty_or_inconsistent_report_is_not_evidence(self):
        for value in [{'testResults': []}, {'testResults': [{'name': 's', 'assertionResults': []}]}]:
            with self.assertRaises(ValueError): evidence.compare(value, report('passed'))
        inconsistent = report('passed'); inconsistent['numTotalTests'] = 2
        with self.assertRaises(ValueError): evidence.compare(inconsistent, report('passed'))

    def test_unknown_status_is_rejected(self):
        with self.assertRaises(ValueError): evidence.compare(report('unknown'), report('passed'))

    def test_cli_removed_duplicate_exits_one(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            before = Path(directory) / 'before.json'
            after = Path(directory) / 'after.json'
            before.write_text(json.dumps(report('passed', 'passed')))
            after.write_text(json.dumps(report('passed')))
            result = subprocess.run([sys.executable, str(SCRIPT), str(before), str(after)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['missing'][0]['count'], 1)

    def test_cli_bad_json_exits_two_without_traceback(self):
        # Existing script itself is non-JSON; no temporary file or dependency needed.
        result = subprocess.run([sys.executable, str(SCRIPT), str(SCRIPT), str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('error', json.loads(result.stdout))


if __name__ == '__main__':
    unittest.main()
