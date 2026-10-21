"""Synthetic-only cross-platform permission adapter checks; no app installation."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('layer-file-permissions.py')
ROOT = Path(os.environ.get('SWB_PERMISSION_TEST_TMPDIR', tempfile.gettempdir()))


class PermissionAdapter(unittest.TestCase):
    def setUp(self):
        ROOT.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix='layer-permissions-', dir=ROOT)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.file = self.root / 'ordinary.png'
        self.file.write_bytes(b'owned synthetic control bytes')

    def inspect(self, p):
        return json.loads(subprocess.check_output([sys.executable, str(SCRIPT), str(p)], text=True))

    def test_ordinary_and_unknown_are_distinct_and_reads_do_not_mutate(self):
        before = self.inspect(self.file)
        self.assertEqual(before['kind'], 'ordinary', before)
        self.assertEqual(self.inspect(self.root / 'missing.png')['kind'], 'unknown')
        self.assertEqual(self.inspect(self.file), before)
        self.assertEqual(self.file.read_bytes(), b'owned synthetic control bytes')

    def test_hardlinks_are_special_without_changing_either_name(self):
        link = self.root / 'alias.png'
        os.link(self.file, link)
        self.assertEqual(self.inspect(self.file)['kind'], 'special')
        self.assertEqual(link.read_bytes(), self.file.read_bytes())

    def test_explicit_acl_is_special_and_original_bytes_remain(self):
        if sys.platform == 'darwin':
            import pwd
            user = pwd.getpwuid(os.getuid()).pw_name
            subprocess.run(['/bin/chmod', '+a', f'user:{user} allow read,write', str(self.file)], check=True)
        elif sys.platform == 'win32':
            user = subprocess.check_output(['whoami'], text=True).strip()
            subprocess.run(['icacls', str(self.file), '/grant:r', user + ':(R,W)'], check=True, capture_output=True)
        else:
            self.fail('no approved platform adapter')
        observed = self.inspect(self.file)
        self.assertEqual(observed['kind'], 'special', observed)
        self.assertEqual(self.file.read_bytes(), b'owned synthetic control bytes')

    def test_metadata_preparation_is_confined_to_staging(self):
        before = self.inspect(self.file)
        staged = self.root / 'staged.png'
        staged.write_bytes(b'new synthetic bytes')
        observed = json.loads(subprocess.check_output([sys.executable, str(SCRIPT), '--prepare', str(self.file), str(staged)], text=True))
        self.assertEqual(observed['kind'], 'ordinary', observed)
        fields = ['mode', 'uid', 'gid', 'flags', 'xattrs'] if sys.platform == 'darwin' else ['security', 'flags']
        for field in fields:
            self.assertEqual(observed[field], before[field])
        self.assertEqual(self.inspect(self.file), before)
        self.assertEqual(staged.read_bytes(), b'new synthetic bytes')

    def test_failed_staging_write_preserves_original_bytes_and_metadata(self):
        import importlib.util
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('layer_file_safety', SCRIPT)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        before = self.inspect(self.file)
        old = self.file.read_bytes()
        real_write = os.write
        def fail_after_prefix(fd, data):
            real_write(fd, data[:5])
            raise OSError(28, 'synthetic ENOSPC after partial staging write')
        with patch.object(module.os, 'write', side_effect=fail_after_prefix):
            result = module.protected_write(str(self.root), str(self.file), b'new complete replacement')
        self.assertEqual(result['effect'], 'refused', result)
        self.assertIn('ENOSPC', result['message'])
        self.assertEqual(self.file.read_bytes(), old)
        self.assertEqual(self.inspect(self.file), before)

    def load_writer(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('layer_file_safety', SCRIPT)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_unverified_complete_windows_security_refuses_without_using_partial_descriptor(self):
        from unittest.mock import patch
        module = self.load_writer()
        before = self.file.stat()
        old = self.file.read_bytes()
        # The fake marks only the unapproved partial reader. It is not evidence
        # for Windows APIs: this test proves the public gate cannot use it.
        with patch.object(module.sys, 'platform', 'win32'), patch.object(module, 'inspect_windows', return_value={'kind': 'ordinary'}) as partial:
            self.assertEqual(module.inspect(str(self.file))['kind'], 'unknown')
            result = module.protected_write(str(self.root), str(self.file), b'new bytes')
            partial.assert_not_called()
        self.assertEqual(result['effect'], 'refused', result)
        self.assertEqual(self.file.read_bytes(), old)
        after = self.file.stat()
        self.assertEqual((after.st_ino, after.st_mode, after.st_uid, after.st_gid), (before.st_ino, before.st_mode, before.st_uid, before.st_gid))

    def test_complete_replacement_and_fresh_publication_preserve_permissions(self):
        module = self.load_writer()
        before = self.inspect(self.file)
        result = module.protected_write(str(self.root), str(self.file), b'complete new content')
        self.assertEqual(result['effect'], 'committed', result)
        self.assertEqual(self.file.read_bytes(), b'complete new content')
        after = self.inspect(self.file)
        fields = ['mode', 'uid', 'gid', 'flags', 'xattrs'] if sys.platform == 'darwin' else ['security', 'flags']
        for field in fields:
            self.assertEqual(after[field], before[field])
        fresh = self.root / 'fresh.png'
        result = module.protected_write(str(self.root), str(fresh), b'complete fresh content')
        self.assertEqual(result['effect'], 'committed', result)
        self.assertEqual(fresh.read_bytes(), b'complete fresh content')
        self.assertEqual(self.inspect(fresh)['links'], 1)
        self.assertEqual(list(self.root.glob('.layer-staging-*')), [])

    def test_failed_close_and_failed_commit_preserve_original(self):
        from unittest.mock import patch
        for phase in ['close', 'replace']:
            with self.subTest(phase=phase):
                module = self.load_writer()
                before = self.inspect(self.file)
                old = self.file.read_bytes()
                replacement = b'x' * 211
                real_close = os.close
                fired = False
                def fail_stage_close(fd):
                    nonlocal fired
                    staged = not fired and os.fstat(fd).st_size == len(replacement)
                    real_close(fd)
                    if staged:
                        fired = True
                        raise OSError('synthetic staging close failure')
                target = 'close' if phase == 'close' else 'replace'
                effect = fail_stage_close if phase == 'close' else OSError('synthetic commit failure')
                with patch.object(module.os, target, side_effect=effect):
                    observed = module.protected_write(str(self.root), str(self.file), replacement)
                self.assertEqual(observed['effect'], 'refused', observed)
                self.assertEqual(self.file.read_bytes(), old)
                self.assertEqual(self.inspect(self.file), before)

    def test_fresh_arrival_is_not_overwritten(self):
        from unittest.mock import patch
        module = self.load_writer()
        fresh = self.root / 'arrived.png'
        real_link = os.link
        def arrive_before_publish(source, target):
            Path(target).write_bytes(b'independent arriving content')
            return real_link(source, target)
        with patch.object(module.os, 'link', side_effect=arrive_before_publish):
            observed = module.protected_write(str(self.root), str(fresh), b'prepared content')
        self.assertNotEqual(observed['effect'], 'committed', observed)
        self.assertEqual(fresh.read_bytes(), b'independent arriving content')

    def test_windows_named_stream_is_special(self):
        if sys.platform != 'win32':
            self.skipTest('Windows-only stream control')
        Path(str(self.file) + ':owned-fixture').write_bytes(b'preserve stream')
        observed = self.inspect(self.file)
        self.assertEqual(observed['kind'], 'special', observed)
        self.assertEqual(Path(str(self.file) + ':owned-fixture').read_bytes(), b'preserve stream')


if __name__ == '__main__':
    unittest.main(verbosity=2)
