#!/usr/bin/env python3
"""Edit only our synthetic working TIFF with independent psdtags/tifffile."""
import base64,json,pathlib,sys,xml.etree.ElementTree as ET
import numpy as np,psdtags,tifffile
from host_output_process import layer_rgba,compose
src,out=map(pathlib.Path,sys.argv[1:3]);mode=sys.argv[3]
with tifffile.TiffFile(src) as f:
 p=f.pages[0];old=p.asarray();layers=psdtags.TiffImageSourceData.frombytes(p.tags[37724].value);xmp=p.tags[700].value
 if isinstance(xmp,str):xmp=xmp.encode()
base=layers.layers.layers[0];top=layers.layers.layers[-1]
assert base.name!=top.name and len(layers.layers.layers)==2
# A real external upper edit; preserve base identity/lock and all XMP.
for c in top.channels:
 k=int(c.channelid)
 if k in [0,1,2,-1]:c.data=np.full_like(c.data,{0:20,1:200,2:30,-1:128}[k])
if mode=='base-pixels':
 for c in base.channels:
  if int(c.channelid)==0:c.data=np.full_like(c.data,1)
if mode=='base-opacity':base.opacity=127
if mode=='base-hidden':base.flags|=psdtags.PsdLayerFlag(2)
if mode in ['wrong-origin','missing-marker']:
 root=ET.fromstring(xmp);prop=root.find('.//{https://storyboard-flow.local/ns/1.0/}sourceReference');assert prop is not None
 if mode=='wrong-origin':
  m=json.loads(base64.b64decode(prop.text));m['original']['digest']='0'*64;prop.text=base64.b64encode(json.dumps(m).encode()).decode()
 else:
  for p in root.iter():
   if prop in list(p):p.remove(prop);break
 xmp=ET.tostring(root)
items=[]
for l in layers.layers.layers:
 items.append({'pixels':layer_rgba(l,old.shape[:2]),'opacity':l.opacity,'hidden':bool(int(l.flags)&2),'blend':l.blendmode.value})
merged=compose(list(reversed(items)))
tifffile.imwrite(out,merged,photometric='rgb',extrasamples=['unassalpha'],metadata=None,extratags=[(37724,7,None,layers.tobytes(),True),(700,1,None,xmp,True)])
print(json.dumps({'file':str(out),'mode':mode,'layers':[l.name for l in layers.layers.layers],'baseOpacity':base.opacity}))
