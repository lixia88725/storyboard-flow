/** Field limits shared by the renderer's inline validation and Main's create path.
 * These are UI-level constraints; the file module still validates every path itself. */
export const PROJECT_FIELD_LIMIT = 200;

const FOLDER_UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** The project folder is derived from the project name because the simplified
 * entry only asks for a name and a location. The caller still validates the
 * result with folderNameIssue; this only removes characters a folder cannot hold. */
export function folderNameFromProjectName(name: string): string {
  const cleaned = typeof name === 'string' ? name.replace(FOLDER_UNSAFE, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') : '';
  return (cleaned || '未命名项目').slice(0, PROJECT_FIELD_LIMIT);
}

/** A new folder beside its image source must not take the source's own name:
 * choosing the source's parent as the location would otherwise collide with the
 * folder the user just opened. */
export function projectFolderNameFor(name: string, sourceFolderName?: string): string {
  const base = folderNameFromProjectName(name);
  const suffix = ' 分镜';
  if (sourceFolderName && base.toLowerCase() === sourceFolderName.toLowerCase())
    return base.slice(0, PROJECT_FIELD_LIMIT - suffix.length) + suffix;
  return base;
}

export function folderNameIssue(folderName: string): string | null {
  if (typeof folderName !== 'string' || !folderName.trim()) return '文件夹名称不能为空';
  if (folderName !== folderName.trim()) return '文件夹名称首尾不能有空格';
  if (folderName.length > PROJECT_FIELD_LIMIT) return '文件夹名称过长';
  if (folderName === '.' || folderName === '..' || folderName.startsWith('.')) return '文件夹名称不能以点开头';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(folderName)) return '文件夹名称含有不能用于文件名的字符';
  return null;
}
