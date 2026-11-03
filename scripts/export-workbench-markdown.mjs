import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {open, link, unlink} from 'node:fs/promises';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';

function heading(text) {
  return text.replace(/[\r\n]+/g,' ').replace(/[\\<>\[\]*_`#]/g, character=>'\\'+character);
}
export function formatScript(project) {
  const lines = ['# '+heading(project.name), ''];
  const dialogues = new Map();
  for (const line of project.dialogues) {
    if (!dialogues.has(line.shotId)) dialogues.set(line.shotId, []);
    dialogues.get(line.shotId).push(line.text);
  }
  for (const [index,shot] of project.shots.entries()) {
    lines.push('## '+String(index+1).padStart(3,'0')+' · '+heading(shot.name), '');
    if (shot.scriptText) lines.push('**动作**','',shot.scriptText,'');
    for (const text of dialogues.get(shot.id) ?? []) lines.push('**对白**','',text,'');
  }
  return lines.join('\n');
}
export async function exportScript(root, destination) {
  if(path.extname(destination).toLowerCase()!=='.md') throw Error('Choose a new .md file.');
  const result = await createProjectStore().loadCheckpoint(path.resolve(root));
  if(!result.ok) throw Error(result.error.message);
  const content = formatScript(result.value.project);
  const temp = path.join(path.dirname(destination),'.flow-export-'+randomUUID());
  const file = await open(temp,'wx');
  try {
    try { await file.writeFile(content,'utf8'); } finally { await file.close(); }
    await link(temp,destination);
  } finally {
    await unlink(temp);
  }
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  if(process.argv.length!==4) throw Error('Usage: node scripts/export-workbench-markdown.mjs PROJECT NEW_FILE.md');
  await exportScript(process.argv[2],process.argv[3]);
}
