#!/usr/bin/env python3
"""Native wire/context state + restart evidence. stdlib only, synthetic private stores."""
import argparse,hashlib,json,pathlib,struct,tempfile
from host_process import Client

def cmyk_tiff(bad_icc=False):
    # Baseline uncompressed separated CMYK TIFF; no proprietary/native decoder fixture.
    tags=[(256,4,1,4),(257,4,1,2),(258,3,4,0),(259,3,1,1),(262,3,1,5),(273,4,1,0),(277,3,1,4),(278,4,1,2),(279,4,1,32),(284,3,1,1),(332,3,1,1)]
    if bad_icc: tags.append((34675,7,12,0))
    tags.sort();end=8+2+12*len(tags)+4;bits=end;icc=bits+8;pixels=icc+(12 if bad_icc else 0)
    out=b'II'+struct.pack('<HIH',42,8,len(tags))
    for tag,kind,count,value in tags:
        if tag==258:value=bits
        elif tag==273:value=pixels
        elif tag==34675:value=icc
        out+=struct.pack('<HHI',tag,kind,count)+(struct.pack('<H',value)+b'\0\0' if kind==3 and count==1 else struct.pack('<I',value))
    return out+struct.pack('<I4H',0,8,8,8,8)+(b'invalid-icc!' if bad_icc else b'')+bytes([0,128,255,0])*8

def main():
    parser=argparse.ArgumentParser();parser.add_argument('binary');args=parser.parse_args()
    evidence=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-context-process-'));events=[]
    c=Client(args.binary,evidence/'tools',record=True)
    for capability in ['toolContextSummaryV1','contextLayerSelectionV1','floatingGestureV1','decimalLayerIdsV1']:
        assert capability in c.hello['capabilities'],c.hello
    def call(op,body):
        result,payload=c.call(op,body);events.append({'op':op,'body':result,'payloadBytes':len(payload)});return result,payload
    def summary():
        s,p=call('summary',{'kind':'summary','maxBytes':49152});assert s['kind']=='contextSummary' and not p,s
        assert len(json.dumps(s,separators=(',',':')).encode())<=49152
        return s
    def floating(op,action):
        s=summary();return call(op,{'kind':'floating','previewId':'piece','expectedContextGeneration':s['contextGeneration'],'action':action})[0]
    p,_=call('new',{'kind':'new','width':32,'height':32});base=c.accept('new',p)
    p,_=call('layer',{'kind':'edit','edit':{'kind':'newLayer','name':'top'}});c.accept('layer',p)
    p,_=call('fill',{'kind':'edit','edit':{'kind':'fill','color':'#ff0000'}});c.accept('fill',p)
    p,_=call('mask',{'kind':'edit','edit':{'kind':'rect','x':4,'y':5,'width':8,'height':7}});base=c.accept('mask',p)
    original,_=c.capture();s=summary();top=s['activeLayerId'];bottom=s['layers'][1]['layerId'];assert isinstance(top,str) and isinstance(bottom,str);version_count=len(list((c.root/'versions').iterdir()))
    result,_=call('choose',{'kind':'selectLayerContext','layerId':bottom,'expectedContextGeneration':s['contextGeneration']});assert result['kind']=='contextUpdated' and result['imageVersionRef']==base,result
    assert len(list((c.root/'versions').iterdir()))==version_count
    s=summary();assert s['activeLayerId']==bottom and s['imageVersionRef']==base
    result,_=call('chooseTop',{'kind':'selectLayerContext','layerId':top,'expectedContextGeneration':s['contextGeneration']});assert result['kind']=='contextUpdated'
    begun=floating('begin',{'kind':'begin','dx':3,'dy':2});assert begun['throughSeq']==1 and begun['durable'] is False
    pixels,frame=c.capture();assert frame['previewId']=='piece' and pixels!=original
    move=floating('move',{'kind':'move','fromSeq':2,'dx':2,'dy':-1});assert move['offset']==[5,1]
    visual,frame=c.capture();assert frame['previewId']=='piece'
    # Keep the exact request and generation: dropped ACK must not apply a second move.
    replay=floating('samePrefix',{'kind':'move','fromSeq':2,'dx':2,'dy':-1});assert replay['kind']=='failure' and replay['error']['code']=='conflict'
    assert c.capture()[0]==visual
    p=floating('drop',{'kind':'drop','throughSeq':2});assert p['kind']=='prepared' and p['floatingPreviewId']=='piece'
    result,_=call('discard',{'kind':'discard','candidateId':'drop'});assert result['kind']=='discarded'
    assert c.capture()[0]==visual and summary()['floating']['phase']=='active'
    result=floating('cancel',{'kind':'cancel','throughSeq':2});assert result['kind']=='floatingCancelled'
    assert c.capture()[0]==original and summary()['floating'] is None
    # Drop ACK lost across SIGKILL: durable prepared is queryable; explicit discard restores base.
    floating('beginLost',{'kind':'begin','dx':5,'dy':1})
    p=floating('lostDrop',{'kind':'drop','throughSeq':1});assert p['kind']=='prepared';version=p['receipt']['versionId'];c.kill()
    c=Client(args.binary,evidence/'tools',record=True)
    result,_=call('load',{'kind':'load','versionId':base});assert result['kind']=='loaded';c.base=base
    assert summary()['selection']['bounds']==[4,5,8,7] and summary()['floating'] is None
    result,_=call('status',{'kind':'status','targetOperationId':'lostDrop'});assert result['state']=='prepared'
    result,_=call('discardRecovered',{'kind':'discard','candidateId':'lostDrop'});assert result['kind']=='discarded'
    assert c.capture()[0]==original and summary()['settlementRequired'] is False
    floating('beginAccept',{'kind':'begin','dx':5,'dy':1});p=floating('dropAccept',{'kind':'drop','throughSeq':1});version=c.accept('dropAccept',p)
    saved,_=c.capture();assert saved==visual and summary()['selection']['bounds']==[9,6,8,7] and summary()['floating'] is None
    c.close();c=Client(args.binary,evidence/'tools')
    result,_=call('loadAccepted',{'kind':'load','versionId':version});assert result['kind']=='loaded';c.base=version
    assert c.capture()[0]==saved and summary()['selection']['bounds']==[9,6,8,7]
    c.close()
    color=[]
    for invalid in [False,True]:
        source=cmyk_tiff(invalid);digest=hashlib.sha256(source).hexdigest();root=evidence/('cmyk-invalid-icc' if invalid else 'cmyk-no-icc');c=Client(args.binary,root)
        source_path=evidence/(root.name+'.tiff');source_path.write_bytes(source)
        result,payload=c.call('open',{'kind':'open','source':{'digest':digest,'byteLength':len(source),'formatHint':'tiff'}},source)
        assert result['kind']=='failure' and result['error']['code']=='unsupported' and not payload,result
        refusal=result
        assert not list((root/'versions').iterdir()) and hashlib.sha256(source_path.read_bytes()).hexdigest()==digest
        result,_=c.call('abandon',{'kind':'abandon','targetOperationId':'open'});assert result['kind']=='discarded';c.close()
        color.append({'invalidICC':invalid,'sha256':digest,'bytes':len(source),'noAcceptedVersion':True,'failure':refusal})
    (evidence/'result.json').write_text(json.dumps({'events':events,'cmykRefusals':color,'passed':True},indent=2))
    print(json.dumps({'evidence':str(evidence),'events':len(events),'cmykRefusals':2,'passed':True}))
if __name__=='__main__':main()
