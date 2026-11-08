"""Inspect actual release ZIPs before uploading them; no extraction or execution."""
import hashlib
import re
import json
import os
from pathlib import Path
import zipfile



NATIVE_UPSTREAM = "a259993118ac7ce1d4c828a385abbc3191841e86"
NATIVE_RUST = "1.99.1"
NATIVE_LICENSES = ["PHOTOCRAFT-MIT.txt", "PHOTOCRAFT-APACHE.txt", "PHOTOCRAFT-NOTICE.txt", "THIRD-PARTY.txt", "OFL-Inter.txt", "OFL-JetBrainsMono.txt", "LICENSE-libfacedetection.txt"]


NATIVE_COMPONENTS = {"reader": "flow-photocraft", "host": "flow-photocraft-host", "lease": "flow-project-lease"}
NATIVE_CAPABILITIES = {
    "reader": ["readerProtocolV1"],
    "host": ["immutableVersionExportV1", "detachedImageJobsV1", "flowV1UpgradeInterpretationV1", "readonlyExportMetadataV1", "strokePipelineV1", "settledResumeV1", "flowBrushPresetsV1", "intrinsicSelectionPaintGuardV1", "productImageEditsV1", "toolContextSummaryV1", "productEditPreviewV1", "temporarySelectionContextV1"],
    "lease": ["writerLeaseV1", "rootIdentityV1", "checkReleaseV1"],
}


def validate_native(archive, resources, windows):
    prefix = resources + "photocraft/"
    names = set(archive.namelist())
    required = [prefix + name + (".exe" if windows else "") for name in NATIVE_COMPONENTS.values()]
    required += [prefix + "build.json"] + [prefix + "licenses/" + n for n in NATIVE_LICENSES]
    if any(n not in names or archive.getinfo(n).file_size == 0 for n in required):
        raise ValueError("PhotoCraft binary/build receipt/licenses missing")
    receipt = json.loads(archive.read(prefix + "build.json"))
    expected = {"protocol": 2, "profile": "release", "upstream": NATIVE_UPSTREAM, "rust": NATIVE_RUST,
                "platform": "win32" if windows else "darwin", "arch": "x64" if windows else "arm64",
                "target": "x86_64-pc-windows-msvc" if windows else "aarch64-apple-darwin"}
    if any(receipt.get(k) != v for k, v in expected.items()) or not re.fullmatch(r"[a-f0-9]{64}", receipt.get("sourceDigest", "")):
        raise ValueError("PhotoCraft native build target/version mismatch")
    inventory = receipt.get("licenses", {})
    if not isinstance(inventory, dict) or any(n not in inventory for n in NATIVE_LICENSES) or not any(n.startswith("source-notices/") for n in inventory):
        raise ValueError("PhotoCraft dependency notice inventory missing")
    actual_notices = {n[len(prefix + "licenses/"):] for n in names if n.startswith(prefix + "licenses/") and not n.endswith("/")}
    if actual_notices != set(inventory):
        raise ValueError("PhotoCraft dependency notice inventory differs")
    for leaf, digest in inventory.items():
        if not isinstance(leaf, str) or "\\" in leaf or leaf.startswith("/") or any(p in ["", ".", ".."] for p in leaf.split("/")):
            raise ValueError("Unsafe PhotoCraft notice path")
        member = prefix + "licenses/" + leaf
        if member not in names or hashlib.sha256(archive.read(member)).hexdigest() != digest:
            raise ValueError("PhotoCraft dependency notice missing or changed: " + leaf)
    license_digest = hashlib.sha256(json.dumps(inventory, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    components = receipt.get("components", {})
    if not isinstance(components, dict) or set(components) != set(NATIVE_COMPONENTS):
        raise ValueError("PhotoCraft component receipt identity mismatch")
    for kind, name in NATIVE_COMPONENTS.items():
        component = components[kind]
        if not isinstance(component, dict) or any(component.get(k) != expected[k] for k in ["platform", "arch", "target", "profile"]) or component.get("protocol") != 1 or component.get("name") != name + (".exe" if windows else "") or component.get("licensesSha256") != license_digest:
            raise ValueError("PhotoCraft component capability/identity mismatch")
        capabilities = component.get("capabilities", [])
        if not isinstance(capabilities, list) or any(not isinstance(c, str) or not c for c in capabilities) or len(set(capabilities)) != len(capabilities) or any(c not in capabilities for c in NATIVE_CAPABILITIES[kind]):
            raise ValueError("PhotoCraft component capability mismatch")
        for key in ["sha256"] + (["packagedSha256"] if "packagedSha256" in component else []):
            if not isinstance(component.get(key), str) or not re.fullmatch(r"[a-f0-9]{64}", component[key]):
                raise ValueError("PhotoCraft component digest invalid")
        with archive.open(prefix + component["name"]) as f:
            header = f.read(64)
            if windows:
                offset = int.from_bytes(header[60:64], "little")
                if len(header) != 64 or header[:2] != b"MZ" or offset > 1024 * 1024:
                    raise ValueError("PhotoCraft PE header missing")
                f.seek(offset)
                pe = f.read(26)
                if len(pe) != 26 or pe[:4] != b"PE\0\0" or pe[4:6] != b"\x64\x86" or pe[24:26] != b"\x0b\x02":
                    raise ValueError("PhotoCraft PE x64 architecture mismatch")
            elif header[:8] != b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01":
                raise ValueError("PhotoCraft Mach-O arm64 architecture mismatch")
            f.seek(0)
            digest = hashlib.sha256()
            while chunk := f.read(1024 * 1024):
                digest.update(chunk)
            if digest.hexdigest() != component.get("packagedSha256", component["sha256"]):
                raise ValueError("PhotoCraft " + kind + " binary digest mismatch")
    if windows:
        raise ValueError("Native workspace lease is unsupported on Windows; packaging is unavailable")


def validate_package(zip_path, version, license_bytes):
    windows = zip_path.name == "Storyboard-Flow-Windows-x64.zip"
    if not windows and zip_path.name != "Storyboard-Flow-macOS-arm64.zip":
        raise ValueError("Unexpected asset name")
    root = "Storyboard Flow-Windows-x64/" if windows else "Storyboard Flow.app/Contents/"
    resources = root + ("resources/" if windows else "Resources/")
    app = resources + "app/"
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        if len(names) != len(archive.namelist()):
            raise ValueError("Duplicate ZIP member")
        for item in archive.infolist():
            if item.filename.endswith("src/renderer/normalSaveMetadataHistory.test.ts"):
                raise ValueError("Forbidden source file in package")
            if (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Aliased ZIP member")
        required = [app + "src/project-files/main/formats/codec.py", app + "src/platform/main/platform/publish_directory.py", app + "src/platform/main/platform/pending_output.py", app + "package.json", app + "LICENSE", app + "dist/index.html",
                    app + "dist-electron/platform/main/flowEditorEntry.js", app + "src/platform/preload/flowEditor.cjs",
                    app + "node_modules/sharp/LICENSE",
                    root + ("LICENSE" if windows else "Resources/LICENSE"),
                    root + ("LICENSES.chromium.html" if windows else "Resources/LICENSES.chromium.html"),
                    root + ("Storyboard Flow.exe" if windows else "MacOS/Storyboard Flow")]
        if windows:
            required += [resources + "python/python.exe", resources + "python/LICENSE.txt",
                         app + "node_modules/@img/sharp-win32-x64/LICENSE"]
        else:
            required += [app + "node_modules/@img/sharp-darwin-arm64/LICENSE",
                         app + "node_modules/@img/sharp-libvips-darwin-arm64/versions.json"]
        missing = [n for n in required if n not in names or archive.getinfo(n).file_size == 0]
        for script in ["layer-file-permissions.py"]:
            member = app + "scripts/" + script
            if member not in names or archive.getinfo(member).file_size == 0:
                missing.append(member)
        if missing:
            raise ValueError("Missing packaged files/notices: " + ", ".join(missing))
        validate_native(archive, resources, windows)
        if json.loads(archive.read(app + "package.json")).get("main") != "dist-electron/platform/main/flowEditorEntry.js":
            raise ValueError("Retired application entry")
        if archive.read(app + "LICENSE") != license_bytes:
            raise ValueError("Project MIT license mismatch")
        if json.loads(archive.read(app + "package.json"))["version"] != version:
            raise ValueError("Packaged version mismatch")
        if not any(n.startswith(resources + "python-deps/photoshop-tiff/psdtags/") for n in names):
            raise ValueError("Python TIFF dependencies missing")
        if not any(n.startswith(resources + "python-deps/photoshop-tiff/") and ".dist-info/" in n and ("LICENSE" in n.upper() or "COPYING" in n.upper()) for n in names):
            raise ValueError("Python dependency notices missing")
        # Bundled libvips carries its own LGPL/third-party notices; MIT does not replace them.
        native = app + "node_modules/@img/" + ("sharp-win32-x64/" if windows else "sharp-libvips-darwin-arm64/")
        notices = [n for n in names if n.startswith(native) and ("LICENSE" in n.upper() or "COPYING" in n.upper())]
        if not windows:
            readme = native + "README.md"
            if readme not in names or b"LGPLv3" not in archive.read(readme):
                raise ValueError("libvips licensing table missing")
        elif not notices:
            raise ValueError("Native library notices missing")
        bad = archive.testzip()
        if bad:
            raise ValueError("Corrupt ZIP member: " + bad)


def find_release_package(directory, expected):
    # Embedded Python distributions contain their own ZIPs; only named release
    # outputs belong to the delivery boundary, not archives inside the app.
    matches = list(Path(directory).rglob("Storyboard-Flow-*.zip"))
    if len(matches) != 1 or matches[0].name != expected:
        raise ValueError("Expected exactly one platform ZIP")
    return matches[0]


if __name__ == "__main__":
    expected = os.environ["EXPECTED_ASSET"]
    package = find_release_package(os.environ["STORYBOARD_FLOW_PACKAGE_DIR"], expected)
    validate_package(package, os.environ["STORYBOARD_FLOW_VERSION"], Path("LICENSE").read_bytes())
    print("Validated package contents, version and retained license notices: " + expected)
