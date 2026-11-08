"""Synthetic archives only; checks real macOS framework link admission."""
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('validator', Path(__file__).with_name('validate-release-package.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
BASE = 'Storyboard Flow.app/Contents/Frameworks/Electron Framework.framework/'


def archive(extra=None, omit=()):
    items = {
        BASE + 'Versions/A/Electron Framework': (False, b'binary'),
        BASE + 'Versions/A/Resources/notice': (False, b'notice'),
        BASE + 'Versions/Current': (True, b'A'),
        BASE + 'Electron Framework': (True, b'Versions/Current/Electron Framework'),
        BASE + 'Resources': (True, b'Versions/Current/Resources'),
    }
    items.update(extra or {})
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as output:
        for name, (linked, data) in items.items():
            if name in omit:
                continue
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (0o120777 if linked else 0o100644) << 16
            output.writestr(info, data)
    return zipfile.ZipFile(stream)


class FrameworkLinks(unittest.TestCase):
    def test_normal_framework_chain_and_implicit_directory(self):
        with archive() as z:
            validator.validate_archive_links(z, False)

    def test_windows_rejects_all_aliases(self):
        with archive() as z, self.assertRaises(ValueError):
            validator.validate_archive_links(z, True)

    def test_native_component_cannot_alias_even_internal_file(self):
        name = 'Storyboard Flow.app/Contents/Resources/photocraft/flow-photocraft-host'
        with archive({name: (True, b'flow-photocraft')}) as z, self.assertRaises(ValueError):
            validator.validate_archive_links(z, False)

    def test_escape_absolute_cycle_and_foreign_target_rejected(self):
        for target in [b'../../../../outside', b'/tmp/outside', b'Current', b'../Other.framework/Versions/A']:
            with self.subTest(target=target), archive({BASE + 'Versions/Current': (True, target)}) as z, self.assertRaises(ValueError):
                validator.validate_archive_links(z, False)

    def test_dangling_target_rejected(self):
        with archive(omit=[BASE + 'Versions/A/Electron Framework']) as z, self.assertRaises(ValueError):
            validator.validate_archive_links(z, False)

    def test_member_under_alias_cannot_hide_missing_target(self):
        with archive({BASE + 'Versions/Current/Electron Framework': (False, b'fake')}, omit=[BASE + 'Versions/A/Electron Framework']) as z, self.assertRaises(ValueError):
            validator.validate_archive_links(z, False)

    def test_arbitrary_framework_link_rejected(self):
        with archive({BASE + 'Versions/A/escape': (True, b'../../Resources')}) as z, self.assertRaises(ValueError):
            validator.validate_archive_links(z, False)

    def test_unsafe_member_path_rejected(self):
        for name in ['/absolute', 'a/../b', 'a//b', 'a\\b']:
            with self.subTest(name=name), archive({name: (False, b'x')}) as z, self.assertRaises(ValueError):
                validator.validate_archive_links(z, False)


if __name__ == '__main__':
    unittest.main()
