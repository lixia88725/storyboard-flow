import path from 'node:path';
import {mkdir, access} from 'node:fs/promises';
import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';

const [folder, widthArg = '2048', countArg = '6'] = process.argv.slice(2);
const width = Number(widthArg), count = Number(countArg), height = width * 9 / 16;
if (!folder || ![2048,4096].includes(width) || !Number.isInteger(count) || count < 1 || count > 1000)
  throw Error('Usage: workbench-sample.mjs NEW_FOLDER [2048|4096] [1..1000]');
const root = path.resolve(folder);
try {
  await mkdir(root);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  // Existing work, including incomplete preparation, must never be reseeded.
  await access(path.join(root, '.storyboard-flow/checkpoints/project.json'));
  process.exit(0);
}
function value(result) {
  if (!result.ok) throw Error(result.error.message);
  return result.value;
}
const depot = value(await openFlowAssetDepot({root, sessionId:'sample', maxPixels:width*height, maxPngBytes:32*1024*1024}));
let serial = 0;
async function put(buffer) {
  return value(await depot.put({operationId:'sample-'+(++serial), png:buffer, width, height})).assetId;
}
async function solid(background) {
  return put(await sharp({create:{width,height,channels:4,background}}).png().toBuffer());
}
const paper = await solid('#f8f5ed'), blank = await solid('#00000000');
const project = {schema:'storyboard-flow.project',version:1,id:'studio-sample',revision:0,
  name:'雨夜来客 · 工作室试画',shots:[],parkedShots:[],images:{},dialogues:[]};
const actions = ['雨夜，小屋有一扇亮着的窗。','旅人走近门口。','他抬手敲门。','屋里的人抬起头。','门打开，两人对视。','旅人走进小屋。'];
for (let i=0;i<=count;i++) {
  const x = 100 + (i*37)%440;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 960 540">
    <g stroke="#435160" stroke-width="5" fill="none"><path d="M0 421h960 M490 420V180l180-110 195 110v240 M620 421V255h90v166"/>
    <rect x="760" y="220" width="65" height="84" fill="#e8c97e"/><circle cx="${x}" cy="266" r="25"/>
    <path d="M${x} 291l-4 68-30 60m30-60 32 60m-30-108-42 44m42-44 44 32"/></g>
    <g stroke="#9caab6" opacity=".6">${Array.from({length:96},(_,j)=>`<path d="M${(j*63+i*7)%980} ${(j*33+i)%280}l-15 40"/>`).join('')}</g>
    <text x="40" y="494" font-size="25" fill="#536470">SCENE 01 / ${i+1}</text></svg>`;
  const art = await put(await sharp(Buffer.from(svg)).png().toBuffer());
  const shot = {id:'shot-'+i,imageId:'image-'+i,name:String((i+1)*10).padStart(4,'0'),scriptText:actions[i%actions.length]};
  (i===count ? project.parkedShots : project.shots).push(shot);
  const layers = [['paper','纸张','image',paper],['art','示例线稿','paint',art],['ink','自由绘画','paint',blank]];
  project.images[shot.imageId] = {id:shot.imageId,revision:0,width,height,layers:layers.map(([id,name,kind,assetId])=>({
    id,name,kind,assetId,locked:id==='paper',visible:true,opacity:1,blendMode:'normal',width,height}))};
  if(i%3===2) project.dialogues.push({id:'line-'+i,shotId:shot.id,text:'有人在吗？'});
}
value(await createProjectStore().saveCheckpoint(root,project,async id=>value(await depot.read(id))));
