import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type PythonCommand = {
  executable: string;
  args?: string[];
};

type PythonCommandCandidatesOptions = {
  pythonPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  pathExists?: (candidate: string) => boolean;
};

type RunPythonScriptOptions = PythonCommandCandidatesOptions & {
  scriptPath: string;
  scriptArgs: string[];
  errorPrefix: string;
  commands?: PythonCommand[];
};

type PythonFailure = {
  command: PythonCommand;
  error: Error & { code?: string | number | null };
  stdout: string;
  stderr: string;
};

export const describePythonCommand = (command: PythonCommand): string =>
  [command.executable, ...(command.args ?? [])].join(" ");

export const pythonCommandCandidates = ({
  pythonPath,
  env = process.env,
  platform = process.platform,
  resourcesPath = electronResourcesPath(),
  pathExists = existsSync
}: PythonCommandCandidatesOptions = {}): PythonCommand[] => {
  if (pythonPath) {
    return [{ executable: pythonPath }];
  }

  const override = env.SWB_PYTHON_BIN?.trim();
  if (override) {
    return [{ executable: override }];
  }

  if (platform === "win32") {
    const packagedPythonPath = resourcesPath ? path.join(resourcesPath, "python", "python.exe") : undefined;
    const packagedPython = packagedPythonPath && pathExists(packagedPythonPath)
      ? [{ executable: packagedPythonPath }]
      : [];

    return [
      ...packagedPython,
      { executable: "python3" },
      { executable: "python" },
      { executable: "py", args: ["-3.14"] },
      { executable: "py", args: ["-3"] }
    ];
  }

  return [{ executable: "python3" }];
};

export const runPythonScript = async ({
  pythonPath,
  env = process.env,
  platform = process.platform,
  scriptPath,
  scriptArgs,
  errorPrefix,
  commands
}: RunPythonScriptOptions): Promise<void> => {
  const candidates = commands ?? pythonCommandCandidates({ pythonPath, env, platform });
  const failures: PythonFailure[] = [];

  for (const command of candidates) {
    const result = await runCommand(command, scriptPath, scriptArgs, env);
    if (result.ok) {
      return;
    }

    failures.push(result.failure);

    if (pythonPath || !isRetryablePythonStartupFailure(result.failure)) {
      break;
    }
  }

  throw new Error(`${errorPrefix}: ${formatPythonFailures(failures)}`);
};

const runCommand = (
  command: PythonCommand,
  scriptPath: string,
  scriptArgs: string[],
  env: NodeJS.ProcessEnv
): Promise<{ ok: true } | { ok: false; failure: PythonFailure }> => {
  return new Promise((resolve) => {
    execFile(
      command.executable,
      [...(command.args ?? []), scriptPath, ...scriptArgs],
      { env },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true });
          return;
        }

        resolve({
          ok: false,
          failure: {
            command,
            error,
            stdout,
            stderr
          }
        });
      }
    );
  });
};

const isRetryablePythonStartupFailure = (failure: PythonFailure): boolean => {
  const message = [String(failure.error.code ?? ""), failure.error.message, failure.stdout, failure.stderr].join("\n");

  return [
    /ENOENT/iu,
    /not recognized as an internal or external command/iu,
    /Python was not found/iu,
    /No Python at/iu,
    /ModuleNotFoundError: No module named ['"](imagecodecs|numpy|tifffile|psdtags)['"]/iu,
    /ImportError:.*(imagecodecs|numpy|tifffile|psdtags)/isu,
    /DLL load failed/iu
  ].some((pattern) => pattern.test(message));
};

const formatPythonFailures = (failures: PythonFailure[]): string =>
  failures
    .map((failure) => {
      const details = [failure.error.message, failure.stdout.trim(), failure.stderr.trim()]
        .filter(Boolean)
        .join("\n");
      return `Tried ${describePythonCommand(failure.command)}: ${details}`;
    })
    .join("\n");

const electronResourcesPath = (): string | undefined => {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  return processWithResources.resourcesPath;
};
