import { execFile } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPathInsideFolder } from "./pathSafety.js";
import { pythonCommandCandidates } from "./pythonRuntime.js";

/** Certify metadata before the existing Import transaction moves any originals.
 * Only staging metadata may change here; never write or rename the old target.
 * This is preparation, not a substitute for the transaction's recovery contract.
 */
export const prepareProtectedLayerReplacement = async (
  root: string, target: string, staging: string
): Promise<void> => {
  if (await realpath(root) !== path.resolve(root)) throw new Error("[PNG_REFUSED] Import workspace has a path alias");
  for (const file of [target, staging]) {
    assertPathInsideFolder(root, file);
    if (await realpath(file) !== path.resolve(file)) throw new Error("[PNG_REFUSED] Import replacement has a path alias");
  }
  // Directory rename authority must not bypass the target's write authority.
  const handle = await open(target, "r+");
  await handle.close();
  const script = fileURLToPath(new URL("../../scripts/layer-file-permissions.py", import.meta.url));
  for (const candidate of pythonCommandCandidates({})) {
    const result = await new Promise<{ missing?: boolean; output?: string; error?: string }>(resolve => {
      execFile(candidate.executable, [...(candidate.args ?? []), "-I", "-B", script, "--prepare", target, staging],
        { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 30000, maxBuffer: 65536 },
        (error, output, stderr) => resolve(error ? { missing: error.code === "ENOENT", error: `${error.message}; ${stderr}` } : { output }));
    });
    if (result.missing) continue;
    if (result.error) throw new Error(`[PNG_REFUSED] Import metadata preparation failed: ${result.error}`);
    let value: { kind?: string; reason?: string };
    try { value = JSON.parse(result.output ?? ""); } catch { throw new Error("[PNG_REFUSED] Invalid Import metadata certification"); }
    if (value?.kind !== "ordinary") throw new Error(`[PNG_REFUSED] Import replacement cannot preserve metadata: ${value?.reason ?? "unknown"}`);
    return;
  }
  throw new Error("[PNG_REFUSED] No existing Python interpreter for Import metadata certification");
};
