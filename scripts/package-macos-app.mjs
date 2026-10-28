import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageVersion = process.env.STORYBOARD_FLOW_VERSION ?? rootPackageJson.version;
const macArch = process.env.STORYBOARD_FLOW_MAC_ARCH ?? process.arch;
const outputRoot =
  process.env.STORYBOARD_FLOW_PACKAGE_DIR ??
  path.resolve(repoRoot, "../../..", "storyboard-flow-packages");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const packageRoot = path.join(outputRoot, timestamp);
const appName = "Storyboard Flow";
const appDir = path.join(packageRoot, `${appName}.app`);
const appResources = path.join(appDir, "Contents", "Resources");
const packagedAppRoot = path.join(appResources, "app");
const sharpRuntimePackage = `sharp-darwin-${macArch}`;
const sharpLibvipsPackage = `sharp-libvips-darwin-${macArch}`;

const requiredSourcePaths = [
  path.join(repoRoot, "dist", "index.html"),
  path.join(repoRoot, "dist-electron", "main", "main.js"),
  path.join(repoRoot, "electron", "preload", "preload.cjs"),
  path.join(repoRoot, "dist-resources", "python-deps", "photoshop-tiff"),
  path.join(repoRoot, "node_modules", "electron", "dist", "Electron.app"),
  path.join(repoRoot, "node_modules", "sharp"),
  path.join(repoRoot, "node_modules", "@img", sharpRuntimePackage),
  path.join(repoRoot, "node_modules", "@img", sharpLibvipsPackage),
  path.join(repoRoot, "node_modules", "@img", "colour"),
  path.join(repoRoot, "node_modules", "detect-libc"),
  path.join(repoRoot, "node_modules", "semver")
];

const requiredPackagedPaths = [
  path.join(packagedAppRoot, "package.json"),
  path.join(packagedAppRoot, "dist", "index.html"),
  path.join(packagedAppRoot, "dist-electron", "main", "main.js"),
  path.join(packagedAppRoot, "electron", "preload", "preload.cjs"),
  path.join(packagedAppRoot, "node_modules", "sharp"),
  path.join(packagedAppRoot, "node_modules", "@img", sharpRuntimePackage),
  path.join(
    packagedAppRoot,
    "node_modules",
    "@img",
    sharpLibvipsPackage
  ),
  path.join(appResources, "python-deps", "photoshop-tiff")
];

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
};

const copyNodeModule = async (...segments) => {
  await cp(
    path.join(repoRoot, "node_modules", ...segments),
    path.join(packagedAppRoot, "node_modules", ...segments),
    { recursive: true }
  );
};

const assertExists = (paths, label) => {
  const missing = paths.filter((candidate) => !existsSync(candidate));
  if (missing.length > 0) {
    throw new Error(`${label} missing:\n${missing.join("\n")}`);
  }
};

assertExists(requiredSourcePaths, "Package source");

await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });
run("ditto", [path.join(repoRoot, "node_modules", "electron", "dist", "Electron.app"), appDir]);

const electronBinary = path.join(appDir, "Contents", "MacOS", "Electron");
const appBinary = path.join(appDir, "Contents", "MacOS", appName);
await rm(appBinary, { force: true });
await rename(electronBinary, appBinary);

run("/usr/libexec/PlistBuddy", [
  "-c",
  `Set :CFBundleDisplayName ${appName}`,
  "-c",
  `Set :CFBundleExecutable ${appName}`,
  "-c",
  "Set :CFBundleIdentifier local.storyboard-flow",
  "-c",
  "Set :CFBundleName Storyboard Flow",
  "-c",
  `Set :CFBundleShortVersionString ${packageVersion}`,
  "-c",
  `Set :CFBundleVersion ${packageVersion}`,
  path.join(appDir, "Contents", "Info.plist")
]);

await cp(path.join(repoRoot, "node_modules", "electron", "LICENSE"), path.join(appResources, "LICENSE"));
await cp(path.join(repoRoot, "node_modules", "electron", "dist", "LICENSES.chromium.html"), path.join(appResources, "LICENSES.chromium.html"));
await mkdir(path.join(packagedAppRoot, "electron", "preload"), { recursive: true });
await mkdir(path.join(packagedAppRoot, "scripts"), { recursive: true });
await mkdir(path.join(packagedAppRoot, "node_modules", "@img"), { recursive: true });

await cp(path.join(repoRoot, "LICENSE"), path.join(packagedAppRoot, "LICENSE"));
await cp(path.join(repoRoot, "dist"), path.join(packagedAppRoot, "dist"), { recursive: true });
await cp(path.join(repoRoot, "dist-electron"), path.join(packagedAppRoot, "dist-electron"), {
  recursive: true
});
await cp(
  path.join(repoRoot, "electron", "preload", "preload.cjs"),
  path.join(packagedAppRoot, "electron", "preload", "preload.cjs")
);
await cp(
  path.join(repoRoot, "scripts", "photoshop-layered-tiff-export.py"),
  path.join(packagedAppRoot, "scripts", "photoshop-layered-tiff-export.py")
);
await cp(
  path.join(repoRoot, "scripts", "photoshop-layered-tiff-import.py"),
  path.join(packagedAppRoot, "scripts", "photoshop-layered-tiff-import.py")
);
await cp(
  path.join(repoRoot, "scripts", "layer-file-permissions.py"),
  path.join(packagedAppRoot, "scripts", "layer-file-permissions.py")
);
await cp(path.join(repoRoot, "dist-resources"), appResources, { recursive: true });
for (const script of [
  "recovery-origin-permissions.py", "recovery-claim-records.py",
  "recovery-content-permissions.py", "recovery-origin-enrollment.py",
  "recovery-project-permissions.py", "owned-stage-cleanup.py"
]) {
  await cp(path.join(repoRoot, "scripts", script), path.join(packagedAppRoot, "scripts", script));
}

await copyNodeModule("sharp");
await copyNodeModule("@img", sharpRuntimePackage);
await copyNodeModule("@img", sharpLibvipsPackage);
await copyNodeModule("@img", "colour");
await copyNodeModule("detect-libc");
await copyNodeModule("semver");

await writeFile(
  path.join(packagedAppRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "storyboard-flow",
      productName: "Storyboard Flow",
      version: packageVersion,
      private: true,
      license: "MIT",
      type: "module",
      main: "dist-electron/main/main.js",
      dependencies: {
        sharp: "^0.34.2"
      }
    },
    null,
    2
  )}\n`
);

await rm(path.join(appResources, "default_app.asar"), { force: true });
run("find", [appDir, "-name", ".DS_Store", "-delete"]);
run("find", [path.join(packagedAppRoot, "node_modules"), "-type", "d", "-name", ".bin", "-prune", "-exec", "rm", "-rf", "{}", "+"]);

assertExists(requiredPackagedPaths, "Packaged app");
const wrongPythonDepsPath = path.join(appResources, "dist-resources", "python-deps", "photoshop-tiff");
if (existsSync(wrongPythonDepsPath)) {
  throw new Error(`Python deps were packaged at the wrong nested path: ${wrongPythonDepsPath}`);
}

run("codesign", ["--force", "--deep", "--sign", "-", appDir]);

const zipPath = path.join(packageRoot, `Storyboard-Flow-macOS-${macArch}.zip`);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appDir, zipPath]);

console.log(`Packaged ${appDir}`);
console.log(`Created ${zipPath}`);
