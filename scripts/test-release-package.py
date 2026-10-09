"""Generated ZIP fixtures test validation only, not production packaging."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("validator", Path(__file__).with_name("validate-release-package.py"))
assert spec is not None and spec.loader is not None
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class PackageValidation(unittest.TestCase):
    def fixture(self, windows, omit=None, version="0.1.31", license_bytes=b"project MIT"):
        root = "Storyboard Flow-Windows-x64/" if windows else "Storyboard Flow.app/Contents/"
        res = root + ("resources/" if windows else "Resources/")
        app = res + "app/"
        files = {app + "package.json": json.dumps({"version": version}).encode(), app + "LICENSE": license_bytes,
                 app + "dist/index.html": b"html", app + "dist-electron/main/main.js": b"main",
                 app + "electron/preload/preload.cjs": b"preload", app + "node_modules/sharp/LICENSE": b"Apache",
                 root + ("LICENSE" if windows else "Resources/LICENSE"): b"Electron MIT",
                 root + ("LICENSES.chromium.html" if windows else "Resources/LICENSES.chromium.html"): b"Chromium notices",
                 root + ("Storyboard Flow.exe" if windows else "MacOS/Storyboard Flow"): b"runtime",
                 res + "python-deps/photoshop-tiff/psdtags/__init__.py": b"python",
                 res + "python-deps/photoshop-tiff/psdtags.dist-info/LICENSE": b"BSD"}
        if windows:
            files.update({res + "python/python.exe": b"python", res + "python/LICENSE.txt": b"PSF",
                          app + "node_modules/@img/sharp-win32-x64/LICENSE": b"Apache and LGPL"})
        else:
            files.update({app + "node_modules/@img/sharp-darwin-arm64/LICENSE": b"Apache",
                          app + "node_modules/@img/sharp-libvips-darwin-arm64/versions.json": b"{}",
                          app + "node_modules/@img/sharp-libvips-darwin-arm64/README.md": b"libvips LGPLv3"})
        if omit:
            files = {n: data for n, data in files.items() if omit not in n}
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        target = Path(directory.name) / ("Storyboard-Flow-Windows-x64.zip" if windows else "Storyboard-Flow-macOS-arm64.zip")
        with zipfile.ZipFile(target, "w") as archive:
            for n, data in files.items():
                archive.writestr(n, data)
        return target

    def test_both_platforms(self):
        for windows in [True, False]:
            validator.validate_package(self.fixture(windows), "0.1.31", b"project MIT")

    def test_missing_notice(self):
        for omit in ["LICENSES.chromium", "sharp-libvips-darwin-arm64/README", "dist-info/LICENSE"]:
            with self.assertRaises(ValueError):
                validator.validate_package(self.fixture(False, omit=omit), "0.1.31", b"project MIT")

    def test_wrong_version_and_project_license(self):
        for args in [{"version": "0.1.30"}, {"license_bytes": b"wrong"}]:
            with self.assertRaises(ValueError):
                validator.validate_package(self.fixture(True, **args), "0.1.31", b"project MIT")

    def test_missing_python_runtime(self):
        with self.assertRaises(ValueError):
            validator.validate_package(self.fixture(True, omit="python/python.exe"), "0.1.31", b"project MIT")


if __name__ == "__main__":
    unittest.main()
