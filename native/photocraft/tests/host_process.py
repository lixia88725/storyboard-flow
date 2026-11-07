#!/usr/bin/env python3
"""Real subprocess + filesystem synthetic acceptance. Retains evidence; never reads user media."""
import argparse, hashlib, json, os, pathlib, struct, subprocess, tempfile, time, zlib

def png(w,h):
    def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([0,0,0,0])*w)*h))+chunk(b'IEND',b'')
class Client:
    def __init__(self,binary,root,base=None,record=False):
        self.root=root;self.base=base;self.seq=0;self.record=record;self.prefixes={}
        self.log=open(root.parent/(root.name+'-stderr.log'),'ab')
        self.p=subprocess.Popen([binary,'--store',str(root)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log)
        self.hello=self.read()[0];assert self.hello['kind']=='hello',self.hello
        self.epoch=self.hello['workerEpoch']
    def exact(self,n):
        out=b''
        while len(out)<n:
            data=self.p.stdout.read(n-len(out))
            if not data: raise AssertionError(('unexpected EOF',self.p.poll(),out))
            out+=data
        return out
    def read(self):
        h,p=struct.unpack('<II',self.exact(8));assert 0<h<=65536 and p<=67108864,(h,p)
        header=json.loads(self.exact(h));payload=self.exact(p)
        if header.get('body',{}).get('kind')=='frame':
            frame=header['body']['frame'];identity=(frame['workerEpoch'],frame['epoch'],frame['documentId'])
            previous=self.prefixes.get(identity,0);assert frame['inputThrough']>=previous,('epoch input prefix moved backwards',previous,frame)
            self.prefixes[identity]=frame['inputThrough']
        if self.record and header.get('body',{}).get('kind')=='frame':
            frame=header['body']['frame'];directory=self.root.parent/'frames';directory.mkdir(exist_ok=True)
            stem=directory/(str(header['workerEpoch'])+'-'+str(frame['frameSeq']))
            stem.with_suffix('.json').write_text(json.dumps(frame,indent=2));stem.with_suffix('.rgba').write_bytes(payload)
        return header,payload
    def send(self,op,body,payload=b''):
        self.seq+=1
        value={'protocol':1,'requestId':f'r{self.seq}','sessionId':'synthetic','incarnation':'inc1','workerEpoch':self.epoch,'operationId':op,'baseVersion':self.base,'body':body}
        header=json.dumps(value,separators=(',',':')).encode()
        self.p.stdin.write(struct.pack('<II',len(header),len(payload))+header+payload);self.p.stdin.flush()
    def call(self,op,body,payload=b''):
        self.send(op,body,payload);header,pixels=self.read();assert header['operationId']==op,header
        return header['body'],pixels
    def accept(self,op,prepared):
        assert prepared['kind']=='prepared',prepared
        result,_=self.call('accept-'+op,{'kind':'accept','candidateId':op})
        assert result['kind']=='accepted',result
        self.base=result['receipt']['versionId'];return self.base
    def capture(self):
        result,pixels=self.call('capture',{'kind':'capture'});assert result['kind']=='frame',result
        frame=result['frame'];assert frame['baseFrameSeq'] is None and frame['encoding']=='srgb-rgba8-straight'
        assert len(pixels)==frame['width']*frame['height']*4
        assert 'previewId' not in frame or isinstance(frame['previewId'],str)
        return pixels,frame
    def kill(self):
        self.p.kill();self.p.wait(timeout=10);self.log.close()
    def close(self):
        frozen,_=self.call('freeze',{'kind':'freeze'});assert frozen['kind']=='frozen',frozen
        closed,_=self.call('close',{'kind':'close'});assert closed['kind']=='closed',closed
        self.p.wait(timeout=10);assert self.p.returncode==0;self.log.close()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('binary');args=parser.parse_args()
    evidence=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-process-'));root=evidence/'store'
    source=png(512,64);source_sha=hashlib.sha256(source).hexdigest()
    client=Client(args.binary,root,record=True)
    prepared,_=client.call('open',{'kind':'open','source':{'digest':source_sha,'byteLength':len(source),'formatHint':'png'}},source)
    v0=client.accept('open',prepared);blank,first=client.capture()
    begun,_=client.call('begin',{'kind':'strokeBegin','previewId':'stroke1','brush':{'size':12,'opacity':0.5,'seed':19,'color':'#ff0000'},'points':[{'x':12,'y':20,'pressure':1}]});assert begun['kind']=='frame',begun
    append,_=client.call('append',{'kind':'strokeAppend','previewId':'stroke1','fromSeq':2,'points':[{'x':90,'y':20,'pressure':1},{'x':12,'y':20,'pressure':1}]});assert append['kind']=='frame',append
    assert append['frame']['baseFrameSeq']==begun['frame']['frameSeq']
    preview,_=client.capture()
    prepared,_=client.call('paint',{'kind':'strokeFinish','previewId':'stroke1','throughSeq':3});assert prepared['fromLive'] is True,prepared
    v1=client.accept('paint',prepared);painted,frame=client.capture();assert preview==painted and painted!=blank
    # Same operation request, including its original base, returns the durable result without replay.
    client.base=v0
    replay,_=client.call('paint',{'kind':'strokeFinish','previewId':'stroke1','throughSeq':3});assert replay['kind']=='accepted' and replay['receipt']['versionId']==v1,replay
    client.base=v1
    # Prepared return is deliberately dropped before killing the actual worker.
    client.send('lost',{'kind':'edit','edit':{'kind':'fill','color':'#00ff00'}})
    lost_header,_=client.read();lost=lost_header['body'];assert lost['kind']=='prepared',lost
    client.kill();client=Client(args.binary,root,record=True)
    loaded,_=client.call('load',{'kind':'load','versionId':v1});assert loaded['kind']=='loaded';client.base=v1
    status,_=client.call('status',{'kind':'status','targetOperationId':'lost'});assert status['state']=='prepared',status
    v2=client.accept('lost',status['result']);green=client.capture()[0];assert all(green[i:i+4]==bytes([0,255,0,255]) for i in range(0,len(green),4))
    client.kill();client=Client(args.binary,root,record=True)
    loaded,_=client.call('load',{'kind':'load','versionId':v2});assert loaded['kind']=='loaded';client.base=v2
    installed,_=client.call('undo',{'kind':'install','versionId':v0});assert installed['kind']=='installed';client.base=v0
    restored,_=client.capture();assert restored==blank
    installed,_=client.call('redo',{'kind':'install','versionId':v1});assert installed['kind']=='installed';client.base=v1
    restored,_=client.capture();assert restored==painted
    # A real request crosses the framing parser, then SIGKILL interrupts its in-flight native work.
    client.send('interrupted',{'kind':'edit','edit':{'kind':'blur','radius':800}})
    def has_intent(): return any(b'\"operationId\":\"interrupted\"' in p.read_bytes() for p in (root/'ops').glob('segment-*.log'))
    deadline=time.monotonic()+10
    while not has_intent() and time.monotonic()<deadline: time.sleep(.001)
    assert has_intent(),'worker did not durably admit operation'
    client.kill();client=Client(args.binary,root,record=True)
    status,_=client.call('status',{'kind':'status','targetOperationId':'interrupted'})
    assert status['state'] in ('intent','prepared','failed'),status
    if status['state']=='intent':
        client.base=v1
        retry,_=client.call('interrupted',{'kind':'edit','edit':{'kind':'blur','radius':800}})
        # A different base cannot replay an unknown effect either.
        assert retry['kind']=='failure' and retry['error']['code']=='unknown-result',retry
    abandoned,_=client.call('abandon',{'kind':'abandon','targetOperationId':'interrupted'});assert abandoned['kind']=='discarded',abandoned
    client.close()
    assert hashlib.sha256(source).hexdigest()==source_sha
    (evidence/'result.json').write_text(json.dumps({'passed':True,'sourceDigest':source_sha,'versions':[v0,v1,v2],'interruptedState':status['state'],'previewCommitEqual':True,'binaryFrames':True},indent=2))
    print(json.dumps({'passed':True,'evidence':str(evidence),'interruptedState':status['state']}))
if __name__=='__main__':main()
