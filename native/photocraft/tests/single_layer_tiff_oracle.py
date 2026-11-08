#!/usr/bin/env python3
"""Independent verification of explicit TIFF layer record, locks and raw pixels."""
import base64,json,pathlib,sys,xml.etree.ElementTree as ET
import numpy as np,psdtags,tifffile
from host_output_process import layer_rgba
reports=[]
for item in json.loads(pathlib.Path(sys.argv[1]).read_text()):
 with tifffile.TiffFile(item['file']) as f:
  assert len(f.pages)==1;page=f.pages[0];assert 37724 in page.tags,'missing actual layer data'
  merged=page.asarray();data=psdtags.TiffImageSourceData.frombytes(page.tags[37724].value)
  layers=data.layers.layers;assert len(layers)==1;layer=layers[0]
  expected=np.frombuffer(pathlib.Path(item['rgba']).read_bytes(),np.uint8).reshape((item['height'],item['width'],4))
  if merged.shape[2]==3:
   assert np.all(expected[:,:,3]==255),'TIFF omitted nonopaque alpha'
   merged=np.concatenate([merged,np.full((*merged.shape[:2],1),255,np.uint8)],axis=2)
  assert np.array_equal(merged,expected), 'merged pixels changed'
  assert np.array_equal(layer_rgba(layer,expected.shape[:2]),expected), 'stored layer pixels changed'
  assert layer.name=='Background' and layer.opacity==255 and layer.blendmode==psdtags.PsdBlendMode.NORMAL and not int(layer.flags)&2
  locked=[i for i in layer.info if i.key==psdtags.PsdKey.PROTECTED_SETTING];assert len(locked)==1
  assert int(locked[0].value)==5,('lock flags lost',locked[0])
  xml=page.tags[700].value;xml=xml.encode() if isinstance(xml,str) else xml
  m=ET.fromstring(xml).findall('.//{https://storyboard-flow.local/ns/1.0/}metadata');assert len(m)==1
  assert json.loads(base64.b64decode(m[0].text))==item['metadata']
  reports.append({'format':item['format'],'actualLayerRecordCount':1,'name':layer.name,'locks':int(locked[0].value),'mergedPixelsExact':True,'rawLayerPixelsExact':True,'metadataExact':True})
print(json.dumps(reports))
