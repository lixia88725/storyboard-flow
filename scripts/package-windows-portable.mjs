import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("Windows portable packaging must run on Windows.");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageVersion = process.env.STORYBOARD_FLOW_VERSION ?? rootPackageJson.version;
const outputRoot =
  process.env.STORYBOARD_FLOW_PACKAGE_DIR ??
  path.resolve(repoRoot, "../../..", "storyboard-flow-packages");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const packageRoot = path.join(outputRoot, timestamp);
const appName = "Storyboard Flow";
const appFolderName = `${appName}-Windows-x64`;
const appRoot = path.join(packageRoot, appFolderName);
const appResources = path.join(appRoot, "resources");
const packagedAppRoot = path.join(appResources, "app");
const windowsPythonSource = resolveWindowsPythonSource();

const requiredSourcePaths = [
  path.join(repoRoot, "dist", "index.html"),
  path.join(repoRoot, "dist-electron", "main", "main.js"),
  path.join(repoRoot, "electron", "preload", "preload.cjs"),
  path.join(repoRoot, "dist-resources", "python-deps", "photoshop-tiff"),
  path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe"),
  path.join(repoRoot, "node_modules", "sharp"),
  path.join(repoRoot, "node_modules", "@img", "sharp-win32-x64"),
  path.join(repoRoot, "node_modules", "@img", "colour"),
  path.join(repoRoot, "node_modules", "detect-libc"),
  path.join(repoRoot, "node_modules", "semver"),
  windowsPythonSource
];

const requiredPackagedPaths = [
  path.join(appRoot, `${appName}.exe`),
  path.join(packagedAppRoot, "package.json"),
  path.join(packagedAppRoot, "dist", "index.html"),
  path.join(packagedAppRoot, "dist-electron", "main", "main.js"),
  path.join(packagedAppRoot, "electron", "preload", "preload.cjs"),
  path.join(packagedAppRoot, "node_modules", "sharp"),
  path.join(packagedAppRoot, "node_modules", "@img", "sharp-win32-x64"),
  path.join(appResources, "python", "python.exe"),
  path.join(appResources, "python-deps", "photoshop-tiff", "psdtags")
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
await cp(path.join(repoRoot, "node_modules", "electron", "dist"), appRoot, { recursive: true });
await mkdir(path.join(packagedAppRoot, "electron", "preload"), { recursive: true });
await mkdir(path.join(packagedAppRoot, "scripts"), { recursive: true });
await mkdir(path.join(packagedAppRoot, "node_modules", "@img"), { recursive: true });

await rm(path.join(appResources, "default_app.asar"), { force: true });
await rename(path.join(appRoot, "electron.exe"), path.join(appRoot, `${appName}.exe`));

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
await cp(windowsPythonSource, path.join(appResources, "python"), { recursive: true });

await copyNodeModule("sharp");
await copyNodeModule("@img", "sharp-win32-x64");
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

await rm(path.join(packagedAppRoot, "node_modules", ".bin"), { recursive: true, force: true });

assertExists(requiredPackagedPaths, "Packaged app");

const zipPath = path.join(packageRoot, "Storyboard-Flow-Windows-x64.zip");
run("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${escapePowerShellSingleQuoted(appRoot)}' -DestinationPath '${escapePowerShellSingleQuoted(zipPath)}' -Force`
]);

console.log(`Packaged ${appRoot}`);
console.log(`Created ${zipPath}`);

function resolveWindowsPythonSource() {
  const fromEnv = process.env.STORYBOARD_FLOW_WINDOWS_PYTHON_DIR ?? process.env.pythonLocation;
  if (fromEnv) {
    return fromEnv;
  }

  const result = spawnSync("python", ["-c", "import pathlib, sys; print(pathlib.Path(sys.executable).parent)"], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error("Could not locate Windows Python runtime. Set STORYBOARD_FLOW_WINDOWS_PYTHON_DIR.");
  }
  return result.stdout.trim();
}

function escapePowerShellSingleQuoted(value) {
  return value.replace(/'/g, "''");
}
