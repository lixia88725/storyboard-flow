"""Synthetic directory-observation regressions; real macOS metadata, no user data."""
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('layer-file-permissions.py')

@unittest.skipUnless(sys.platform == 'darwin', 'Mac metadata contract')
class DirectoryObservation(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('permissions', SCRIPT)
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory(prefix='directory-observation-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def observe_with_change(self, target, change, persistent=False):
        actual_fstat = os.fstat
        calls = 0
        def observed(fd):
            nonlocal calls
            result = actual_fstat(fd)
            if (result.st_dev, result.st_ino) == (target.stat().st_dev, target.stat().st_ino):
                calls += 1
                if calls == 1 or persistent:
                    change(calls)
            return result
        with patch.object(self.module.os, 'fstat', side_effect=observed):
            return self.module.inspect_mac(str(target), include_acl=True)

    def test_directory_child_churn_reobserves_complete_metadata(self):
        result = self.observe_with_change(self.root, lambda n: (self.root / str(n)).mkdir())
        self.assertEqual(result, self.module.inspect_mac(str(self.root), include_acl=True))
        self.assertEqual(result['kind'], 'ordinary')
        self.assertTrue((self.root / '1').is_dir())

    def test_continuous_churn_remains_refused_and_is_bounded(self):
        with self.assertRaisesRegex(ValueError, 'changed during inspection'):
            self.observe_with_change(self.root, lambda n: (self.root / str(n)).mkdir(), persistent=True)
        self.assertLessEqual(len(list(self.root.iterdir())), 6)

    def test_directory_permission_change_is_not_retried(self):
        os.chmod(self.root, 0o700)
        with self.assertRaisesRegex(ValueError, 'changed during inspection'):
            self.observe_with_change(self.root, lambda n: os.chmod(self.root, 0o750))
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode), 0o750)

    def test_regular_source_change_is_never_retried(self):
        source = self.root / 'source.png'
        source.write_bytes(b'original synthetic bytes')
        with self.assertRaisesRegex(ValueError, 'changed during inspection'):
            self.observe_with_change(source, lambda n: source.write_bytes(b'changed synthetic bytes'))
        self.assertEqual(source.read_bytes(), b'changed synthetic bytes')

    def origin_case(self, phase, persistent=False, permission_change=False):
        spec = importlib.util.spec_from_file_location('origin', SCRIPT.with_name('recovery-origin-permissions.py'))
        assert spec is not None and spec.loader is not None
        origin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(origin)
        target = self.root / 'observed'
        target.mkdir(mode=0o700)
        directories = origin.OriginDirectories(str(self.root), 'a' * 64)
        self.addCleanup(directories.close)
        parent = os.open(self.root, origin.DIRECTORY_FLAGS)
        self.addCleanup(os.close, parent)
        if phase == 'check':
            directories.open(parent, 'observed', True)
        actual_stat = os.stat
        calls = 0
        def observed(name, *args, **kwargs):
            nonlocal calls
            result = actual_stat(name, *args, **kwargs)
            if name == 'observed' and kwargs.get('dir_fd') == parent:
                calls += 1
                if calls == 1 or persistent:
                    if permission_change:
                        os.chmod(target, 0o750)
                    else:
                        (target / str(calls)).mkdir()
            return actual_stat(name, *args, **kwargs) if phase == 'check' else result
        with patch.object(origin.os, 'stat', side_effect=observed):
            if phase == 'check':
                directories.check()
            else:
                directories.open(parent, 'observed', True)
        return calls

    def test_origin_open_reobserves_transient_directory_entry_churn(self):
        self.assertEqual(self.origin_case('open'), 2)

    def test_origin_check_reobserves_transient_directory_entry_churn(self):
        self.assertEqual(self.origin_case('check'), 2)

    def test_origin_directory_churn_remains_bounded_refusal(self):
        with self.assertRaisesRegex(ValueError, 'naming'):
            self.origin_case('open', persistent=True)
        self.assertLessEqual(len(list((self.root / 'observed').iterdir())), 3)

    def test_origin_changed_permissions_are_never_rebased(self):
        with self.assertRaisesRegex(ValueError, 'naming|policy'):
            self.origin_case('check', permission_change=True)

    def test_directory_retry_cannot_adopt_new_permissions_between_attempts(self):
        actual = os.fstat
        identity = self.root.stat().st_ino
        calls = 0
        def observed(fd):
            nonlocal calls
            result = actual(fd)
            if result.st_ino == identity:
                calls += 1
                if calls == 1:
                    (self.root / 'child').mkdir()
                elif calls == 3:
                    os.chmod(self.root, 0o750)
                    return actual(fd)
            return result
        with patch.object(self.module.os, 'fstat', side_effect=observed):
            with self.assertRaisesRegex(ValueError, 'restrictions changed'):
                self.module.inspect_mac(str(self.root), include_acl=True)

if __name__ == '__main__':
    unittest.main()
