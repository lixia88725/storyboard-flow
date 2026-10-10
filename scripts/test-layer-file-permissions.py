"""Synthetic-only cross-platform permission adapter checks; no app installation."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('layer-file-permissions.py')
ROOT = Path(os.environ.get('SWB_PERMISSION_TEST_TMPDIR', str(Path.home() / '.hermes/profiles/engineer/cache/scratch')))


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

    def test_windows_named_stream_is_special(self):
        if sys.platform != 'win32':
            self.skipTest('Windows-only stream control')
        Path(str(self.file) + ':owned-fixture').write_bytes(b'preserve stream')
        observed = self.inspect(self.file)
        self.assertEqual(observed['kind'], 'special', observed)
        self.assertEqual(Path(str(self.file) + ':owned-fixture').read_bytes(), b'preserve stream')


if __name__ == '__main__':
    unittest.main(verbosity=2)
