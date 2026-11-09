import {useLayoutEffect,useRef,useState} from 'react';
import type {Shot} from '../../../drawing/contracts/types';
import type {ImageWorkspaceSnapshot,ImageWorkspaceImageView} from '../../../platform/contracts/imageWorkspace';
import type {ImageWorkspaceController} from './workspaceController';

/** Existing table/layout vocabulary only; no synthetic asset IDs or editable
 * V1 layer tree. The separate native layer view owns the layer presentation. */
export function workspaceShots(snapshot:ImageWorkspaceSnapshot):Shot[]{
 const names=new Map(snapshot.files.outputNames.map(n=>[n.shotId,n.name]));
 return [...snapshot.session.project.shots,...snapshot.session.project.parkedShots].map((shot,order)=>{
  const image=snapshot.images[shot.imageId];
  return{id:shot.id,imagePath:'',fileName:names.get(shot.id)??shot.name,order,scriptText:shot.scriptText,activeLayerId:image?.activeLayerId??undefined,
   flow:{version:2,status:'owned',canvasWidth:image?.width??640,canvasHeight:image?.height??360}};
 });
}

/** Keep low-level codec diagnostics in the snapshot; show an actionable image state. */
export function imageIssueText(image:ImageWorkspaceImageView|undefined):string|undefined{
 if(!image?.issue)return undefined;
 if(image.availability==='recoveryPending')return '这张图片的处理结果尚待确认';
 if(image.issue.code==='resource-limit'||image.issue.code==='backpressure')return '这张图片超出当前处理额度，原文件未改动';
 if(image.issue.code==='unsupported')return '这类图片暂时无法编辑，原文件未改动';
 return '这张图片暂时无法读取，其他图片仍可使用';
}

export function NativeThumbnail({controller,image}:{controller:ImageWorkspaceController;image:ImageWorkspaceImageView|undefined}){
 const canvas=useRef<HTMLCanvasElement>(null),painted=useRef<string|null>(null),[shownVersion,setShownVersion]=useState<{imageId:string;versionId:string|null}|null>(null),[issue,setIssue]=useState('');
 useLayoutEffect(()=>{
  let alive=true;const node=canvas.current;if(!node)return;
  if(painted.current!==image?.imageId){node.width=0;node.height=0;painted.current=null;setShownVersion(null);}setIssue('');
  if(!image?.thumbnailId)return;
  const draw=(value:Awaited<ReturnType<ImageWorkspaceController['thumbnail']>>)=>{
   if(!alive)return;
   if(!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>512||value.height>512||!(value.rgba instanceof Uint8Array)||value.rgba.byteLength!==value.width*value.height*4)throw Error('Invalid thumbnail');
   node.width=value.width;node.height=value.height;
   node.getContext('2d',{colorSpace:'srgb'})?.putImageData(new ImageData(new Uint8ClampedArray(value.rgba),value.width,value.height,{colorSpace:'srgb'}),0,0);painted.current=image!.imageId;setShownVersion({imageId:image!.imageId,versionId:image?.displayNative?.versionId??null});
  };
  const cached=controller.cachedThumbnail(image.thumbnailId);
  if(cached)draw(cached);else void controller.thumbnail(image.thumbnailId).then(draw).catch(()=>{if(alive)setIssue('预览暂时不可用');});
  return()=>{alive=false;};
 },[controller,image?.imageId,image?.thumbnailId]);
 const shown=shownVersion!==null&&shownVersion.imageId===image?.imageId,updating=shown&&shownVersion.versionId!==(image?.displayNative?.versionId??null);
 const previewIssue=issue||(image?.notice?.code==='thumbnail-unavailable'?image.notice.message:'');
 return <div className="image-stage flow-native-thumbnail" style={{width:'100%',height:'100%',position:'relative',aspectRatio:`${image?.width??640}/${image?.height??360}`}}>
  <canvas ref={canvas} style={{display:'block',width:'100%',height:'100%',objectFit:'contain'}}/>
  {!shown&&<span role="status" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontSize:12,color:'#c5cbd3',background:'#25272a',padding:12,textAlign:'center',boxSizing:'border-box'}}>{previewIssue||imageIssueText(image)||'正在准备预览…'}</span>}
  {shown&&(updating||previewIssue)&&<span role="status" style={{position:'absolute',right:4,bottom:4,fontSize:11,background:'#25272acc',padding:'2px 4px'}}>{previewIssue||'更新预览…'}</span>}
 </div>;
}
