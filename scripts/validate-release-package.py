"""Inspect actual release ZIPs before uploading them; no extraction or execution."""
import json
import os
from pathlib import Path
import zipfile


def validate_package(zip_path, version, license_bytes):
    windows = zip_path.name == "Storyboard-Flow-Windows-x64.zip"
    if not windows and zip_path.name != "Storyboard-Flow-macOS-arm64.zip":
        raise ValueError("Unexpected asset name")
    root = "Storyboard Flow-Windows-x64/" if windows else "Storyboard Flow.app/Contents/"
    resources = root + ("resources/" if windows else "Resources/")
    app = resources + "app/"
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        required = [app + "package.json", app + "LICENSE", app + "dist/index.html",
                    app + "dist-electron/main/main.js", app + "electron/preload/preload.cjs",
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
        if missing:
            raise ValueError("Missing packaged files/notices: " + ", ".join(missing))
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
