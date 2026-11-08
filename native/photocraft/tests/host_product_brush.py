#!/usr/bin/env python3
"""Real native product presets. Synthetic stores only; leaves exact RGBA evidence."""
import argparse,json,pathlib,tempfile,hashlib
from host_process import Client
PRESETS=[('hard',8,1,.95,0,.06,.55,.25),('soft',36,.85,.06,0,.05,.3,.6),('pencil',7,1,.5,.55,.035,.45,.6),('eraser-hard',24,1,.9,0,.06,.6,0),('eraser-soft',44,.6,.1,0,.05,.2,.7)]
def run(binary):
 root=pathlib.Path(tempfile.mkdtemp(prefix='flow-product-brush-'));cases=[];checks=[]
 def fixture(name):
  c=Client(binary,root/name);assert 'flowBrushPresetsV1' in c.hello['capabilities'];p,_=c.call('new',{'kind':'new','width':128,'height':96});c.accept('new',p);return c
 def stroke(c,name,brush,size,opacity,points,erase=False):
  params={'size':size,'opacity':opacity,'color':'#224466','erase':erase,'hardness':brush['hardness'],'spacing':brush['spacing'],'seed':brush['seed'],'flowBrush':brush}
  p,_=c.call(name+'-begin',{'kind':'strokeBegin','previewId':name,'brush':params,'points':points[:1]});assert p['kind']=='frame',p
  if len(points)>1:
   p,_=c.call(name+'-append',{'kind':'strokeAppend','previewId':name,'fromSeq':2,'points':points[1:]});assert p['kind']=='frame',p
  preview,_=c.capture();p,_=c.call(name,{'kind':'strokeFinish','previewId':name,'throughSeq':len(points)});assert p.get('fromLive') is True,p;c.accept(name,p);pixels,_=c.capture();assert pixels==preview
  return pixels
 for id,size,opacity,hardness,grain,spacing,ps,po in PRESETS:
  erase=id.startswith('eraser');brush={'tip':'hard' if erase and id.endswith('hard') else 'soft' if erase else id,'hardness':hardness,'grain':grain,'spacing':spacing,'pressureSize':ps,'pressureOpacity':po,'seed':901}
  c=fixture(id)
  if erase:p,_=c.call('fill',{'kind':'edit','edit':{'kind':'fill','color':'#224466'}});c.accept('fill',p)
  points=[{'x':16,'y':48,'pressure':1},{'x':112,'y':48,'pressure':1},{'x':16,'y':48,'pressure':1},{'x':112,'y':48,'pressure':1}]
  # Check a deliberately half-opaque self-overlapping stroke independent of factory opacity.
  first=stroke(c,'first',brush,size,.5,points,erase);second=stroke(c,'second',brush,size,.5,points,erase)
  a=list(first[3::4]);b=list(second[3::4]);assert (min(a)>=127 and min(b)<min(a)) if erase else (max(a)<=128 and max(b)>max(a)),(id,min(a),max(a),min(b),max(b))
  first_path=root/(id+'.rgba');first_path.write_bytes(first)
  case={'id':id,'width':128,'height':96,'native':str(first_path),'erase':erase,'stroke':{'tool':'eraser' if erase else 'brush','color':'#224466','size':size,'opacity':.5,'points':[v for p in points for v in (p['x'],p['y'])],'pressures':[p['pressure'] for p in points],'brush':brush},'nativeMinAlpha':min(a),'nativeMaxAlpha':max(a),'secondMinAlpha':min(b),'secondMaxAlpha':max(b)}
  cases.append(case);c.close()
  stats=[]
  for pressure in [0.2,1]:
   c=fixture(id+'-p'+str(pressure));
   if erase:p,_=c.call('fill',{'kind':'edit','edit':{'kind':'fill','color':'#224466'}});c.accept('fill',p)
   pixels=stroke(c,'dot',brush,size,opacity,[{'x':64,'y':48,'pressure':pressure}],erase);alpha=list(pixels[3::4]);changed=[255-v if erase else v for v in alpha];stats.append({'pressure':pressure,'changed':sum(v>0 for v in changed),'sum':sum(changed),'max':max(changed)});c.close()
  assert stats[0]['changed']<stats[1]['changed'] and stats[0]['sum']<stats[1]['sum'],(id,stats)
  checks.append({'id':id,'pressure':stats,'singleStrokeCap':True,'crossStrokeBuilds':True,'previewEqualsCommit':True})
 (root/'cases.json').write_text(json.dumps(cases,indent=2));(root/'result.json').write_text(json.dumps({'passed':True,'checks':checks,'cases':str(root/'cases.json')},indent=2));print(json.dumps({'passed':True,'evidence':str(root),'presets':5,'pressureCases':10}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('binary');run(p.parse_args().binary)
