#!/usr/bin/env python3
"""Real host Document exports + independent psdtags/tifffile/numpy oracle.
Requires existing task-local dependencies via PYTHONPATH; never installs packages.
PSD section parsing follows https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/ .
"""
import argparse,hashlib,json,pathlib,struct,tempfile,time,zlib,sys
import numpy as np
import psdtags,tifffile,imagecodecs
from host_process import Client

def u32(n):return struct.pack('>I',n)
def block(key,data):
 data=data+b'\0'*(len(data)%2)
 return b'8BIM'+key+u32(len(data))+data
def compose(layers):
 h,w=layers[0]['pixels'].shape[:2];out=np.zeros((h,w,4),np.float64)
 for layer in reversed(layers):
  if layer['hidden']:continue
  src=layer['pixels'].astype(np.float64)/255;sa=src[:,:,3:4]*(layer['opacity']/255);da=out[:,:,3:4];s=src[:,:,:3];d=out[:,:,:3]
  mode=layer['blend'];mixed=s*d if mode==b'mul ' else s+d-s*d if mode==b'scrn' else s
  alpha=sa+da*(1-sa);rgb=sa*(1-da)*s+sa*da*mixed+da*(1-sa)*d
  out=np.concatenate([np.divide(rgb,alpha,out=np.zeros_like(rgb),where=alpha>0),alpha],axis=2)
 return np.rint(out*255).clip(0,255).astype(np.uint8)
def fixture(mode=b'norm',hidden=False,with_opaque=True):
 w,h=8,4;base=np.empty((h,w,4),np.uint8);base[:]=[40,80,160,128];base[:,:2]=[0,0,0,0]
 top=np.empty_like(base);top[:]=[200,100,50,128];top[:,:1]=[0,0,0,0]
 layers=[{'name':'top','pixels':top,'opacity':192,'blend':mode,'hidden':hidden},{'name':'base','pixels':base,'opacity':255,'blend':b'norm','hidden':False}]
 records=[];channels=[]
 for i,l in enumerate(reversed(layers)):
  planes=[struct.pack('>H',0)+l['pixels'][:,:,k].tobytes() for k in range(4)]
  info=block(b'lyid',u32(i+10))+(block(b'zFlw',b'opaque-layer-'+l['name'].encode()+b'-v1') if with_opaque else b'')
  name=l['name'].encode();pas=bytes([len(name)])+name;pas+=b'\0'*((-len(pas))%4)
  extra=u32(0)+u32(0)+pas+info
  records.append(struct.pack('>iiiiH',0,0,h,w,4)+b''.join(struct.pack('>hI',-1 if c==3 else c,len(p)) for c,p in enumerate(planes))+b'8BIM'+l['blend']+bytes([l['opacity'],0,2 if l['hidden'] else 0,0])+u32(len(extra))+extra)
  channels.extend(planes)
 raw=struct.pack('>h',-2)+b''.join(records)+b''.join(channels);raw+=b'\0'*(len(raw)%2)
 mask=u32(len(raw))+raw+u32(0)+(block(b'zGlo',b'opaque-global-v1') if with_opaque else b'')
 data=b'opaque-resource-v1';resource=(b'8BIM'+struct.pack('>H',4001)+b'\0\0'+u32(len(data))+data+b'\0'*(len(data)%2)) if with_opaque else b''
 rgba=compose(layers);a=rgba[:,:,3:4]/255;rgb=np.rint(rgba[:,:,:3]*a+255*(1-a)).astype(np.uint8);merged=np.concatenate([rgb,rgba[:,:,3:4]],axis=2)
 header=b'8BPS'+struct.pack('>H',1)+b'\0'*6+struct.pack('>HIIHH',4,h,w,8,3)
 return header+u32(0)+u32(len(resource))+resource+u32(len(mask))+mask+struct.pack('>H',0)+merged.transpose(2,0,1).tobytes(),layers

def sections(data):
 assert data[:4]==b'8BPS';version=struct.unpack_from('>H',data,4)[0];assert version==1
 channels,h,w,depth,mode=struct.unpack_from('>HIIHH',data,12);assert depth==8 and mode==3
 pos=26
 for _ in range(2):n=struct.unpack_from('>I',data,pos)[0];pos+=4+n
 size=struct.unpack_from('>I',data,pos)[0];start=pos+4;length=struct.unpack_from('>I',data,start)[0]
 layers=psdtags.PsdLayers.frombytes(data[start+4:start+4+length],psdtags.PsdFormat.BE32BIT,psdtags.PsdKey.LAYER)
 tail=start+size;compression=struct.unpack_from('>H',data,tail)[0];raw=data[tail+2:]
 if compression==0:merged=np.frombuffer(raw,np.uint8).reshape(channels,h,w).transpose(1,2,0)
 elif compression==1:
  count=channels*h;sizes=struct.unpack_from('>'+str(count)+'H',raw);off=count*2;rows=[]
  for n in sizes:rows.append(np.frombuffer(imagecodecs.packbits_decode(raw[off:off+n]),np.uint8));off+=n
  merged=np.stack(rows).reshape(channels,h,w).transpose(1,2,0)
 else:raise AssertionError(('unsupported independent merged codec',compression))
 return layers.layers,merged

def layer_rgba(layer,canvas_shape):
 h,w=layer.shape;out=np.zeros((h,w,4),np.uint8);out[:,:,3]=255
 for c in layer.channels:
  key=int(c.channelid)
  if key in [0,1,2,-1]:out[:,:,3 if key==-1 else key]=c.data
 full=np.zeros((*canvas_shape,4),np.uint8)
 rect=layer.rectangle;left,top=rect.left,rect.top
 x0=max(0,left);y0=max(0,top);x1=min(full.shape[1],rect.right);y1=min(full.shape[0],rect.bottom)
 if x1>x0 and y1>y0:full[y0:y1,x0:x1]=out[y0-top:y1-top,x0-left:x1-left]
 return full

def check(file,fmt,native,source_layers,with_opaque):
 data=file.read_bytes()
 if fmt=='psd':layers,merged=sections(data)
 else:
  with tifffile.TiffFile(file) as f:
   page=f.pages[0];assert 37724 in page.tags,'flat TIFF refused';assert tuple(int(x) for x in page.extrasamples)==(2,),page.extrasamples;merged=page.asarray();tag=page.tags[37724].value
  layers=psdtags.TiffImageSourceData.frombytes(tag).layers.layers
 names=[l.name for l in layers];assert names==['base','top'],names
 decoded=[]
 for layer,expected in zip(layers,reversed(source_layers)):
  pixels=layer_rgba(layer,native.shape[:2]);assert np.array_equal(pixels,expected['pixels']),('layer pixel loss',layer.name)
  assert layer.opacity==expected['opacity'] and layer.blendmode.value==expected['blend'];assert bool(int(layer.flags)&2)==expected['hidden']
  marker=b'opaque-layer-'+layer.name.encode()+b'-v1';marker+=b'\0'*(len(marker)%2)
  if with_opaque:assert any(getattr(info,'value',None)==marker for info in layer.info),'opaque layer block missing'
  decoded.append({'name':layer.name,'pixels':pixels,'opacity':layer.opacity,'blend':layer.blendmode.value,'hidden':bool(int(layer.flags)&2)})
 rebuilt=compose(list(reversed(decoded)));delta=int(np.abs(rebuilt.astype(np.int16)-native.astype(np.int16)).max());assert delta<=1,('independent layer composite',delta)
 if fmt=='tiff':merged_delta=int(np.abs(merged.astype(np.int16)-native.astype(np.int16)).max());assert merged_delta<=1,merged_delta
 else:
  alpha=native[:,:,3:4]/255;expected_rgb=np.rint(native[:,:,:3]*alpha+255*(1-alpha)).astype(np.uint8);expected=np.concatenate([expected_rgb,native[:,:,3:4]],axis=2)
  merged_delta=int(np.abs(merged.astype(np.int16)-expected.astype(np.int16)).max());assert merged_delta<=1,('PSD white-matted merged',merged_delta)
 if with_opaque:
  for marker in [b'opaque-global-v1',b'opaque-resource-v1']:assert marker in data,('opaque marker missing',marker)
  if fmt=='psd':
   for name in ['base','top']:
    marker=b'opaque-layer-'+name.encode()+b'-v1';assert block(b'zFlw',marker) in data,'opaque layer block header/data changed'
   assert block(b'zGlo',b'opaque-global-v1') in data,'global block header/data changed'
   marker=b'opaque-resource-v1';assert b'8BIM'+struct.pack('>H',4001)+b'\0\0'+u32(len(marker))+marker in data,'resource header/data changed'
 return {'format':fmt,'reader':'psdtags + tifffile/imagecodecs + numpy','layerNamesBottomToTop':names,'layerRawPixelsExact':True,'independentLayerCompositeMaxDelta':delta,'storedMergedMaxDelta':merged_delta,'mergedRepresentation':'PSD white-matted RGB + alpha' if fmt=='psd' else 'TIFF straight RGBA unassociated alpha','opaqueLayerGlobalResourcePayloadsPreserved':with_opaque}

def check_new_drawing(file,fmt,native):
 if fmt=='psd':layers,merged=sections(file.read_bytes())
 else:
  with tifffile.TiffFile(file) as f:
   assert 37724 in f.pages[0].tags
   merged=f.pages[0].asarray();layers=psdtags.TiffImageSourceData.frombytes(f.pages[0].tags[37724].value).layers.layers
 assert len(layers)==1 and layers[0].name=='Drawing'
 placed=layer_rgba(layers[0],native.shape[:2]);recomposed=compose([{'pixels':placed,'opacity':layers[0].opacity,'blend':layers[0].blendmode.value,'hidden':bool(int(layers[0].flags)&2)}]);layer_delta=int(np.abs(recomposed.astype(np.int16)-native.astype(np.int16)).max());assert layer_delta<=1,layer_delta
 if fmt=='psd':
  alpha=native[:,:,3:4]/255;expected=np.concatenate([np.rint(native[:,:,:3]*alpha+255*(1-alpha)).astype(np.uint8),native[:,:,3:4]],axis=2)
 else:expected=native
 merged_delta=int(np.abs(merged.astype(np.int16)-expected.astype(np.int16)).max());assert merged_delta<=1,merged_delta
 return {'scene':'new-engine-live-stroke','format':fmt,'layers':1,'independentLayerCompositeMaxDelta':layer_delta,'storedMergedMaxDelta':merged_delta}

def new_drawing(c,preview,seed,color):
 result,_=c.call('begin-'+preview,{'kind':'strokeBegin','previewId':preview,'brush':{'size':3,'opacity':.5,'seed':seed,'color':color},'points':[{'x':3,'y':2}]});assert result['kind']=='frame',result
 result,_=c.call('append-'+preview,{'kind':'strokeAppend','previewId':preview,'fromSeq':2,'points':[{'x':6,'y':2}]});assert result['kind']=='frame'
 pixels,_=c.capture();prepared,_=c.call('finish-'+preview,{'kind':'strokeFinish','previewId':preview,'throughSeq':2});assert prepared['fromLive'] is True;version=c.accept('finish-'+preview,prepared);assert c.capture()[0]==pixels
 return version,np.frombuffer(pixels,np.uint8).reshape(4,8,4)

def main():
 p=argparse.ArgumentParser();p.add_argument('binary');args=p.parse_args();root=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-output-'));print(json.dumps({'evidence':str(root)}),file=sys.stderr);reports=[]
 for name,mode,hidden,with_opaque in [(name,mode,hidden,False) for name,mode,hidden in [('normal',b'norm',False),('multiply',b'mul ',False),('screen',b'scrn',False),('hidden',b'norm',True)]]+[(name+'-opaque',mode,False,True) for name,mode in [('normal',b'norm'),('multiply',b'mul '),('screen',b'scrn')]]:
  source,layers=fixture(mode,hidden,with_opaque);(root/(name+'-source.psd')).write_bytes(source);store=root/(name+'-store');c=Client(args.binary,store)
  prepared,_=c.call('open',{'kind':'open','source':{'digest':hashlib.sha256(source).hexdigest(),'byteLength':len(source),'formatHint':'psd'}},source);assert prepared['kind']=='prepared',prepared;version=c.accept('open',prepared);pixels,header=c.capture();native=np.frombuffer(pixels,np.uint8).reshape(4,8,4);expected=compose(layers);assert int(np.abs(native.astype(np.int16)-expected.astype(np.int16)).max())<=1
  # Actual process death proves export consumes the persisted Document, not the source model.
  c.kill();c=Client(args.binary,store);loaded,_=c.call('load',{'kind':'load','versionId':version});assert loaded['kind']=='loaded';c.base=version;c.call('freeze',{'kind':'freeze'})
  for fmt in ['psd','tiff']:
   value,payload=c.call('export-'+fmt,{'kind':'export','versionId':version,'format':fmt,'maxBytes':64<<20})
   if with_opaque and fmt=='tiff':
    assert value['kind']=='failure' and value['error']['code']=='export-loss' and not payload,value;reports.append({'scene':name,'format':fmt,'refused':True,'reason':value['error']['message']});continue
   assert value['kind']=='exported',value;assert value['sha256']==hashlib.sha256(payload).hexdigest() and value['byteLength']==len(payload) and value['opaqueBlockCount']>=(4 if with_opaque else 0),value
   target=root/(name+'-out.'+fmt);target.write_bytes(payload);report=check(target,fmt,native,layers,with_opaque);report.update({'scene':name,'receipt':value});reports.append(report)
  resumed,_=c.call('resume',{'kind':'resume'});assert resumed['kind']=='resumed';stroke,_=c.call('draw-after-save',{'kind':'strokeBegin','previewId':'continued','brush':{'size':2,'seed':1},'points':[{'x':4,'y':2}]});assert stroke['kind']=='frame';c.call('cancel',{'kind':'strokeCancel','previewId':'continued'});c.close();assert (root/(name+'-source.psd')).read_bytes()==source,'source fixture changed'
 # New engine LiveStroke -> durable native version -> real PSD/TIFF -> resume -> more drawing.
 c=Client(args.binary,root/'new-drawing-store');prepared,_=c.call('new',{'kind':'new','width':8,'height':4});c.accept('new',prepared);version,native=new_drawing(c,'p1',55,'#ff0000');c.call('freeze',{'kind':'freeze'});first={}
 for fmt in ['psd','tiff']:
  value,payload=c.call('export-'+fmt,{'kind':'export','versionId':version,'format':fmt,'maxBytes':64<<20});assert value['kind']=='exported',value;target=root/('new-drawing.'+fmt);target.write_bytes(payload);reports.append(check_new_drawing(target,fmt,native));first[fmt]=payload
 resumed,_=c.call('resume',{'kind':'resume'});assert resumed['kind']=='resumed';next_version,next_pixels=new_drawing(c,'p2',56,'#0000ff');assert next_version!=version and not np.array_equal(next_pixels,native);c.call('freeze-next',{'kind':'freeze'})
 for fmt in ['psd','tiff']:
  value,payload=c.call('export-old-'+fmt,{'kind':'export','versionId':version,'format':fmt,'maxBytes':64<<20});assert value['kind']=='exported' and payload==first[fmt],value
  tiny,none=c.call('too-small-'+fmt,{'kind':'export','versionId':version,'format':fmt,'maxBytes':len(payload)-1});assert tiny['kind']=='failure' and tiny['error']['code']=='limit' and not none,tiny
 assert np.array_equal(np.frombuffer(c.capture()[0],np.uint8).reshape(4,8,4),next_pixels),'old-version export changed working document';c.close()
 reports.append({'scene':'resume-draw-and-export-old-version','oldVersion':version,'currentVersion':next_version,'oldOutputBytesStable':True,'undersizedBudgetRejectedWithoutPayload':True})
 # Noncanonical odd opaque payload is not silently normalized under a lossless claim.
 odd,_=fixture();marker=b'8BIMzFlw'+u32(20)+b'opaque-layer-top-v1'+b'\0';assert marker in odd;odd=odd.replace(marker,b'8BIMzFlw'+u32(19)+b'opaque-layer-top-v1'+b'\0',1);(root/'odd-opaque-source.psd').write_bytes(odd)
 c=Client(args.binary,root/'odd-store');prepared,_=c.call('open',{'kind':'open','source':{'digest':hashlib.sha256(odd).hexdigest(),'byteLength':len(odd),'formatHint':'psd'}},odd);version=c.accept('open',prepared);c.call('freeze',{'kind':'freeze'});refused,payload=c.call('odd-output',{'kind':'export','versionId':version,'format':'psd','maxBytes':64<<20});assert refused['kind']=='failure' and refused['error']['code']=='export-loss' and not payload,refused;c.close();reports.append({'scene':'odd-opaque-payload','refused':True,'reason':refused['error']['message']})
 result={'passed':True,'scope':'real native version load/export; independent structural/channel/composite decoding; no Photoshop/GUI/file-publication certification','reports':reports};(root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({'evidence':str(root),'result':result}))
if __name__=='__main__':main()
