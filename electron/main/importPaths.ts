import { realpath } from "node:fs/promises";
import path from "node:path";

type UniquePath = (
  directory: string,
  fileName: string,
  isReserved?: (candidate: string) => boolean
) => Promise<string>;

// Use a known existing ASCII path component, without enumerating directories.
// A known child probes the destination itself; otherwise empty/new directories
// inherit the canonical parent's semantics (not a symlink's containing folder).
// This inheritance does not establish semantics across arbitrary mount boundaries.
const probeCaseInsensitive = async (canonical: string): Promise<boolean> => {
  const name = path.basename(canonical);
  if (!/[a-z]/i.test(name)) {
    const parent = path.dirname(canonical);
    if (parent === canonical) throw new Error(`Cannot probe Import path case semantics: ${canonical}`);
    return probeCaseInsensitive(parent);
  }
  const alternate = name.replace(/[a-z]/i, (letter) =>
    letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()
  );
  try {
    return await realpath(path.join(path.dirname(canonical), alternate)) === canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
};

const directoryIdentity = async (directory: string, knownPath?: string): Promise<{ directory: string; caseInsensitive: boolean }> => {
  let existing = path.resolve(directory);
  const suffix: string[] = [];
  while (true) {
    let canonical: string;
    try {
      canonical = await realpath(existing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      suffix.unshift(path.basename(existing));
      existing = parent;
      continue;
    }
    let probe = canonical;
    if (knownPath && suffix.length === 0) {
      const child = await realpath(knownPath);
      if (path.dirname(child) === canonical && /[a-z]/i.test(path.basename(child))) probe = child;
    }
    return { directory: path.join(canonical, ...suffix), caseInsensitive: await probeCaseInsensitive(probe) };
  }
};

// One allocator per Import. Call in shot order before concurrent image work;
// uniquePath retains its disk checks, suffix convention and attempt limit.
export const createImportPathReservation = (uniquePath: UniquePath) => {
  const reserved = new Set<string>();
  const identities = new Map<string, Awaited<ReturnType<typeof directoryIdentity>>>();
  return async (directory: string, fileName: string, knownPath?: string): Promise<string> => {
    let identity = identities.get(directory);
    if (!identity) {
      identity = await directoryIdentity(directory, knownPath);
      identities.set(directory, identity);
    }
    const key = (candidate: string) => {
      return path.join(identity.directory, identity.caseInsensitive ? path.basename(candidate).toLowerCase() : path.basename(candidate));
    };
    const selected = await uniquePath(directory, fileName, (candidate) => reserved.has(key(candidate)));
    reserved.add(key(selected));
    return selected;
  };
};
