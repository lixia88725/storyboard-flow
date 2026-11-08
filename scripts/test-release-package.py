"""Generated ZIP fixtures test validation only, not production packaging."""
import importlib.util
import hashlib
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
    def fixture(self, windows, omit=None, version="0.1.31", license_bytes=b"project MIT", native_arch_wrong=False, native_target=None, native_digest=None, native_rust=None, signed=False, mutate=None):
        root = "Storyboard Flow-Windows-x64/" if windows else "Storyboard Flow.app/Contents/"
        res = root + ("resources/" if windows else "Resources/")
        app = res + "app/"
        files = {app + "src/project-files/main/formats/codec.py": b"codec", app + "src/platform/main/platform/publish_directory.py": b"publish", app + "src/platform/main/platform/pending_output.py": b"pending", app + "package.json": json.dumps({"version": version, "main": "dist-electron/platform/main/flowEditorEntry.js"}).encode(), app + "LICENSE": license_bytes,
                 app + "dist/index.html": b"html", app + "dist-electron/platform/main/flowEditorEntry.js": b"main",
                 app + "src/platform/preload/flowEditor.cjs": b"preload", app + "node_modules/sharp/LICENSE": b"Apache",
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
        prefix = res + "photocraft/"
        binary = bytearray(128)
        if windows:
            binary[:2] = b"MZ"
            binary[60:64] = (64).to_bytes(4, "little")
            binary[64:68] = b"PE\0\0"
            binary[68:70] = (0xAA64 if native_arch_wrong else 0x8664).to_bytes(2, "little")
            binary[88:90] = b"\x0b\x02"
        else:
            binary[:8] = b"\xcf\xfa\xed\xfe" + (0x1000007 if native_arch_wrong else 0x100000C).to_bytes(4, "little")
        original_digest = hashlib.sha256(binary).hexdigest()
        if signed:
            binary.extend(b"synthetic signature")
        for name in validator.NATIVE_COMPONENTS.values():
            files[prefix + name + (".exe" if windows else "")] = bytes(binary)
        licenses = {}
        for leaf in validator.NATIVE_LICENSES + ["source-notices/dependency.txt"]:
            data = ("synthetic " + leaf).encode()
            files[prefix + "licenses/" + leaf] = data
            licenses[leaf] = hashlib.sha256(data).hexdigest()
        receipt = {"protocol": 2, "profile": "release", "upstream": validator.NATIVE_UPSTREAM, "rust": native_rust or validator.NATIVE_RUST,
                   "platform": "win32" if windows else "darwin", "arch": "x64" if windows else "arm64",
                   "target": native_target or ("x86_64-pc-windows-msvc" if windows else "aarch64-apple-darwin"),
                   "sourceDigest": "a" * 64, "licenses": licenses}
        license_digest = hashlib.sha256(json.dumps(licenses, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        receipt["components"] = {kind: {"name": name + (".exe" if windows else ""), "sha256": native_digest or original_digest, "protocol": 1,
                                      "platform": receipt["platform"], "arch": receipt["arch"], "target": receipt["target"], "profile": "release",
                                      "capabilities": validator.NATIVE_CAPABILITIES[kind], "licensesSha256": license_digest}
                                 for kind, name in validator.NATIVE_COMPONENTS.items()}
        if signed:
            for component in receipt["components"].values():
                component["packagedSha256"] = hashlib.sha256(binary).hexdigest()
        if mutate:
            mutate(files, receipt, prefix)
        files[prefix + "build.json"] = json.dumps(receipt).encode()
        for script in ["layer-file-permissions.py"]:
            files[app + "scripts/" + script] = b"synthetic helper"
        if omit:
            files = {n: data for n, data in files.items() if omit not in n}
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        target = Path(directory.name) / ("Storyboard-Flow-Windows-x64.zip" if windows else "Storyboard-Flow-macOS-arm64.zip")
        with zipfile.ZipFile(target, "w") as archive:
            for n, data in files.items():
                archive.writestr(n, data)
        return target

    def test_mac_admitted_windows_explicitly_refused(self):
        validator.validate_package(self.fixture(False), "0.1.31", b"project MIT")
        with self.assertRaisesRegex(ValueError, "lease is unsupported on Windows"):
            validator.validate_package(self.fixture(True), "0.1.31", b"project MIT")

    def test_missing_notice(self):
        for omit in ["LICENSES.chromium", "sharp-libvips-darwin-arm64/README", "dist-info/LICENSE"]:
            with self.assertRaises(ValueError):
                validator.validate_package(self.fixture(False, omit=omit), "0.1.31", b"project MIT")

    def test_wrong_version_and_project_license(self):
        for args in [{"version": "0.1.30"}, {"license_bytes": b"wrong"}]:
            with self.assertRaises(ValueError):
                validator.validate_package(self.fixture(True, **args), "0.1.31", b"project MIT")

    def test_missing_new_codec(self):
        with self.assertRaisesRegex(ValueError, "codec.py"):
            validator.validate_package(self.fixture(False, omit="codec.py"), "0.1.31", b"project MIT")

    def test_missing_publish_worker(self):
        with self.assertRaisesRegex(ValueError, "publish_directory.py"):
            validator.validate_package(self.fixture(False, omit="publish_directory.py"), "0.1.31", b"project MIT")

    def test_missing_python_runtime(self):
        with self.assertRaises(ValueError):
            validator.validate_package(self.fixture(True, omit="python/python.exe"), "0.1.31", b"project MIT")
        for windows in [False, True]:
            for script in ["layer-file-permissions.py"]:
                with self.subTest(windows=windows, script=script), self.assertRaises(ValueError):
                    validator.validate_package(self.fixture(windows, omit="scripts/" + script), "0.1.31", b"project MIT")

    def test_missing_native_binary(self):
        for windows in [False, True]:
            with self.subTest(windows=windows), self.assertRaisesRegex(ValueError, "PhotoCraft"):
                validator.validate_package(self.fixture(windows, omit="photocraft/flow-photocraft"), "0.1.31", b"project MIT")

    def test_missing_native_license(self):
        for omit in validator.NATIVE_LICENSES + ["source-notices/dependency.txt", "build.json"]:
            with self.subTest(omit=omit), self.assertRaisesRegex(ValueError, "PhotoCraft"):
                validator.validate_package(self.fixture(False, omit=omit), "0.1.31", b"project MIT")

    def test_wrong_native_architecture(self):
        for windows in [False, True]:
            with self.subTest(windows=windows), self.assertRaisesRegex(ValueError, "architecture"):
                validator.validate_package(self.fixture(windows, native_arch_wrong=True), "0.1.31", b"project MIT")

    def test_wrong_native_target(self):
        for windows in [False, True]:
            with self.subTest(windows=windows), self.assertRaisesRegex(ValueError, "target/version"):
                validator.validate_package(self.fixture(windows, native_target="aarch64-pc-windows-msvc"), "0.1.31", b"project MIT")

    def test_wrong_native_toolchain(self):
        with self.assertRaisesRegex(ValueError, "target/version"):
            validator.validate_package(self.fixture(False, native_rust="stable"), "0.1.31", b"project MIT")

    def test_changed_native_binary(self):
        with self.assertRaisesRegex(ValueError, "digest"):
            validator.validate_package(self.fixture(True, native_digest="b" * 64), "0.1.31", b"project MIT")

    def test_signed_native_binary_receipt(self):
        validator.validate_package(self.fixture(False, signed=True), "0.1.31", b"project MIT")

    def test_each_native_component_required(self):
        for name in validator.NATIVE_COMPONENTS.values():
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "PhotoCraft"):
                validator.validate_package(self.fixture(False, omit="photocraft/" + name), "0.1.31", b"project MIT")

    def test_every_component_capability_and_bytes_are_bound(self):
        for kind in validator.NATIVE_COMPONENTS:
            def corrupt(files, receipt, prefix):
                files[prefix + receipt["components"][kind]["name"]] += b"changed"
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "digest"):
                validator.validate_package(self.fixture(False, mutate=corrupt), "0.1.31", b"project MIT")
        for cap in validator.NATIVE_CAPABILITIES["host"]:
            def remove_cap(files, receipt, prefix):
                receipt["components"]["host"]["capabilities"] = [c for c in validator.NATIVE_CAPABILITIES["host"] if c != cap]
            with self.subTest(cap=cap), self.assertRaisesRegex(ValueError, "capability"):
                validator.validate_package(self.fixture(False, mutate=remove_cap), "0.1.31", b"project MIT")

    def test_release_selection_ignores_embedded_python_archives(self):
        target = self.fixture(True)
        internal = target.parent / "timestamp" / "Storyboard Flow-Windows-x64" / "resources" / "python" / "python312.zip"
        internal.parent.mkdir(parents=True)
        internal.write_bytes(b"embedded runtime archive")
        self.assertEqual(validator.find_release_package(target.parent, target.name), target)

    def test_release_selection_rejects_duplicate_or_wrong_platform_outputs(self):
        target = self.fixture(True)
        duplicate = target.parent / "other-run" / target.name
        duplicate.parent.mkdir()
        duplicate.write_bytes(target.read_bytes())
        with self.assertRaises(ValueError):
            validator.find_release_package(target.parent, target.name)
        with self.assertRaises(ValueError):
            validator.find_release_package(target.parent, "Storyboard-Flow-macOS-arm64.zip")


if __name__ == "__main__":
    unittest.main()
