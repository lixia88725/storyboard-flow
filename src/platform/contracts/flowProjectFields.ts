/** Field limits shared by the renderer's inline validation and Main's create path.
 * These are UI-level constraints; the file module still validates every path itself. */
export const PROJECT_FIELD_LIMIT = 200;

export function folderNameIssue(folderName: string): string | null {
  if (typeof folderName !== 'string' || !folderName.trim()) return '文件夹名称不能为空';
  if (folderName !== folderName.trim()) return '文件夹名称首尾不能有空格';
  if (folderName.length > PROJECT_FIELD_LIMIT) return '文件夹名称过长';
  if (folderName === '.' || folderName === '..' || folderName.startsWith('.')) return '文件夹名称不能以点开头';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(folderName)) return '文件夹名称含有不能用于文件名的字符';
  return null;
}
