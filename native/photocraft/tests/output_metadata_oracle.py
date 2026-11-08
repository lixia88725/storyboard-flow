#!/usr/bin/env python3
"""Independent metadata/layer/merged-byte check; uses only already-installed codecs."""
import base64,json,pathlib,struct,sys,xml.etree.ElementTree as ET
import imagecodecs,numpy as np,psdtags,tifffile
FLOW='{https://storyboard-flow.local/ns/1.0/}'
def psd(data):
 assert data[:6]==b'8BPS\0\1'
 channels,h,w,depth,mode=struct.unpack_from('>HIIHH',data,12);assert depth==8 and mode==3
 pos=26;n=struct.unpack_from('>I',data,pos)[0];pos+=4+n
 n=struct.unpack_from('>I',data,pos)[0];pos+=4;end=pos+n;xmp=[]
 while pos<end:
  assert data[pos:pos+4]==b'8BIM';rid=struct.unpack_from('>H',data,pos+4)[0];pos+=6
  size=data[pos]+1;pos+=size+(size%2);n=struct.unpack_from('>I',data,pos)[0];pos+=4
  if rid==1060:xmp.append(data[pos:pos+n])
  pos+=n+n%2
 assert pos==end and len(xmp)==1
 n=struct.unpack_from('>I',data,pos)[0];pos+=4;end=pos+n
 size=struct.unpack_from('>I',data,pos)[0];layers=psdtags.PsdLayers.frombytes(data[pos+4:pos+4+size],psdtags.PsdFormat.BE32BIT,psdtags.PsdKey.LAYER).layers
 compression=struct.unpack_from('>H',data,end)[0];raw=data[end+2:]
 if compression==0:merged=np.frombuffer(raw,np.uint8).reshape(channels,h,w).transpose(1,2,0)
 elif compression==1:
  count=channels*h;sizes=struct.unpack_from('>'+str(count)+'H',raw);off=count*2;rows=[]
  for n in sizes:rows.append(np.frombuffer(imagecodecs.packbits_decode(raw[off:off+n]),np.uint8));off+=n
  merged=np.stack(rows).reshape(channels,h,w).transpose(1,2,0)
 else:raise AssertionError(('unverified PSD merged codec',compression))
 return layers,merged,xmp[0]
def inspect(file,expected,rgba=None,unknown=False,layer_colors=None):
 data=file.read_bytes()
 if file.suffix=='.psd':layers,merged,xmp=psd(data)
 else:
  with tifffile.TiffFile(file) as f:
   assert len(f.pages)==1;page=f.pages[0];assert 37724 in page.tags and 700 in page.tags
   merged=page.asarray();layers=psdtags.TiffImageSourceData.frombytes(page.tags[37724].value).layers.layers;xmp=page.tags[700].value
 if isinstance(xmp,str):xmp=xmp.encode()
 props=ET.fromstring(xmp).findall('.//'+FLOW+'metadata');assert len(props)==1
 envelope=json.loads(base64.b64decode(props[0].text,validate=True));assert envelope==expected,(envelope,expected)
 if unknown:assert b"u:unchanged='exact'" in xmp
 if rgba is not None:
  native=np.frombuffer(rgba,np.uint8).reshape(merged.shape[0],merged.shape[1],4)
  # These fixtures are opaque, so PSD's white-matted merged and RGBA native are comparable.
  if merged.shape[2]==3:merged=np.concatenate([merged,np.full((*merged.shape[:2],1),255,np.uint8)],axis=2)
  assert merged.shape==native.shape;assert np.abs(merged.astype(np.int16)-native.astype(np.int16)).max()<=1
 if layer_colors is not None:
  assert len(layer_colors)==len(layers)
  for layer,color in zip(layers,layer_colors):
   h,w=layer.shape;pixels=np.zeros((h,w,4),np.uint8);pixels[:,:,3]=255
   for channel in layer.channels:
    key=int(channel.channelid)
    if key in [0,1,2,-1]:pixels[:,:,3 if key==-1 else key]=channel.data
   full=np.zeros((*merged.shape[:2],4),np.uint8);r=layer.rectangle
   x0=max(0,r.left);y0=max(0,r.top);x1=min(full.shape[1],r.right);y1=min(full.shape[0],r.bottom)
   if x1>x0 and y1>y0:full[y0:y1,x0:x1]=pixels[y0-r.top:y1-r.top,x0-r.left:x1-r.left]
   assert np.all(full==np.array(color,np.uint8)),('layer pixels were baked/changed',layer.name)
 return {'file':str(file),'layerCount':len(layers),'layerOpacityBytes':[l.opacity for l in layers],'metadata':envelope,'unknownXmpPreserved':unknown,'mergedCompared':rgba is not None,'layerPixelsCompared':layer_colors is not None}
if __name__=='__main__':
 request=json.loads(pathlib.Path(sys.argv[1]).read_text());reports=[]
 for item in request:
  reports.append(inspect(pathlib.Path(item['file']),item['envelope'],pathlib.Path(item['rgba']).read_bytes() if 'rgba' in item else None,item.get('unknown',False),item.get('layerColors')))
 print(json.dumps(reports,ensure_ascii=False))
