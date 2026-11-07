#!/usr/bin/env python3
"""Real SIGKILL, Main-surrogate committed/native unsettled, unknown, and quota refusal."""
import argparse,json,os,pathlib,tempfile,time
from host_process import Client

def start(c):
 value,_=c.call('start',{'kind':'pipelineStart','maxPendingStrokes':4,'maxPendingPoints':64,'maxRetainedPixelBytes':16<<20});assert value['kind']=='pipelineReady',value;return value['pipelineId']
def stroke(c,op,pred=None):
 begun,_=c.call('begin-'+op,{'kind':'strokeBegin','previewId':op,'predecessorOperationId':pred,'brush':{'size':14,'opacity':.5,'seed':12,'color':'#ff0000'},'points':[{'x':20,'y':20}]});assert begun['kind']=='frame',begun
 shown,_=c.call('append-'+op,{'kind':'strokeAppend','previewId':op,'fromSeq':2,'points':[{'x':80,'y':20}]});assert shown['kind']=='frame',shown
 queued,_=c.call(op,{'kind':'strokeFinish','previewId':op,'throughSeq':2});assert queued['kind']=='queued' and queued['durable'] is False,queued;return queued
def poll(c,pipeline):
 state,_=c.call('poll',{'kind':'pipelinePoll','pipelineId':pipeline});assert state['kind']=='pipelineState',state;return state
def wait(c,pipeline,test):
 deadline=time.monotonic()+15
 while True:
  state=poll(c,pipeline)
  found=test(state)
  if found:return found
  assert time.monotonic()<deadline,state;time.sleep(.001)
def main():
 p=argparse.ArgumentParser();p.add_argument('binary');args=p.parse_args();root=pathlib.Path(tempfile.mkdtemp(prefix='flow-native-pipeline-failures-'));scenes=[]
 # Main has a durable project decision, but acceptQueued is killed before native journal flush.
 os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']='500';c=Client(args.binary,root/'cas-before-native');assert set(['recoveredCandidateAcceptAtInstalledVersion','strokePipelineV1'])<=set(c.hello['capabilities'])
 prepared,_=c.call('new',{'kind':'new','width':512,'height':64});old=c.accept('new',prepared);pipeline=start(c);queued=stroke(c,'paint')
 prepared=wait(c,pipeline,lambda s:next((e['result'] for e in s['events'] if e['operationId']=='paint' and e['result']['kind']=='prepared'),None));new=prepared['receipt']['versionId']
 decision={'schema':'synthetic-main-project-cas','operationId':'paint','expected':old,'installed':new};decision_file=root/'project-decision.json'
 with open(decision_file,'wb') as f:f.write(json.dumps(decision).encode());f.flush();os.fsync(f.fileno())
 ack,_=c.call('accept',{'kind':'accept','candidateId':'paint'});assert ack['kind']=='acceptQueued' and ack['durable'] is False,ack
 status,_=c.call('query-inflight',{'kind':'status','targetOperationId':'paint'});assert status['state']=='prepared' and status['acceptPending'] is True,status
 c.kill();os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']='0';c=Client(args.binary,root/'cas-before-native');loaded,_=c.call('load',{'kind':'load','versionId':new});assert loaded['kind']=='loaded',loaded;c.base=new
 status,_=c.call('query-restart',{'kind':'status','targetOperationId':'paint'});assert status['state']=='prepared',status
 settled,_=c.call('explicit-reconcile',{'kind':'accept','candidateId':'paint'});assert settled['kind']=='accepted' and settled['receipt']['versionId']==new,settled
 c.kill();c=Client(args.binary,root/'cas-before-native');c.call('load',{'kind':'load','versionId':new});c.base=new
 # Durable accepted reply intentionally lost: repeat settlement does not apply pixels again.
 status,_=c.call('lost-accepted-query',{'kind':'status','targetOperationId':'paint'});assert status['state']=='accepted';again,_=c.call('reconcile-again',{'kind':'accept','candidateId':'paint'});assert again==settled;c.close();scenes.append({'case':'Main CAS durable/native accept pending SIGKILL','beforeKill':'prepared+acceptPending','afterRestart':'prepared','explicitReconcile':'accepted','lostAcceptedReply':'idempotent'})
 # Kill after durable intent but before snapshot/prepared: unknown must never be replayed.
 os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']='300';c=Client(args.binary,root/'unknown');prepared,_=c.call('new',{'kind':'new','width':512,'height':64});old=c.accept('new',prepared);pipeline=start(c);stroke(c,'unknownPaint')
 deadline=time.monotonic()+10
 def has_intent():return any(b'"operationId":"unknownPaint"' in f.read_bytes() for f in (root/'unknown'/'ops').glob('segment-*.log'))
 while not has_intent():assert time.monotonic()<deadline;time.sleep(.001)
 time.sleep(.02);c.kill();os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']='0';c=Client(args.binary,root/'unknown');c.call('load',{'kind':'load','versionId':old});c.base=old
 status,_=c.call('query-unknown',{'kind':'status','targetOperationId':'unknownPaint'});assert status['state']=='intent',status
 replay,_=c.call('unknownPaint',{'kind':'strokeFinish','previewId':'unknownPaint','throughSeq':2});assert replay['kind']=='failure' and replay['error']['code']=='unknown-result',replay
 abandoned,_=c.call('abandon',{'kind':'abandon','targetOperationId':'unknownPaint'});assert abandoned['kind']=='discarded';c.close();scenes.append({'case':'SIGKILL after intent','restart':'intent','replay':'unknown-result','cleanup':'explicit abandon retains evidence'})
 # A real zero-headroom native-store quota rejects IO and freezes all dependent input.
 c=Client(args.binary,root/'budget');prepared,_=c.call('new',{'kind':'new','width':512,'height':64});old=c.accept('new',prepared);c.close()
 used=sum(f.stat().st_size for f in (root/'budget').rglob('*') if f.is_file());os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']='100';c=Client(args.binary,root/'budget',budget=used);c.call('load',{'kind':'load','versionId':old});c.base=old;pipeline=start(c);admission=stroke(c,'quota');stroke(c,'dependent1','quota');stroke(c,'dependent2','dependent1');stroke(c,'dependent3','dependent2')
 state=wait(c,pipeline,lambda s:s if s['blocked'] and all(op['state']=='failure' for op in s['operations']) else None);assert state['queueDepth']==4 and state['pendingPoints']==8,state
 status,_=c.call('quota-query',{'kind':'status','targetOperationId':'quota'});assert status['state']=='failure' and status['admission']['inputDigest']==admission['inputDigest'],status
 next_input,_=c.call('later',{'kind':'strokeBegin','previewId':'later','predecessorOperationId':'quota','brush':{},'points':[{'x':90,'y':20}]});assert next_input['kind']=='failure' and next_input['error']['code']=='pipeline-blocked',next_input
 frozen,_=c.call('freeze',{'kind':'freeze'});closed,_=c.call('close',{'kind':'close'});assert frozen['kind']=='failure' and closed['kind']=='failure';c.kill();os.environ['FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS']='0'
 c=Client(args.binary,root/'budget');c.call('load',{'kind':'load','versionId':old});c.base=old;status,_=c.call('after-quota',{'kind':'status','targetOperationId':'quota'});assert status['state']=='absent',status;c.close();scenes.append({'case':'zero headroom quota','queuedWasDurable':False,'actorRetainedPoints':8,'frozenDependentOperations':3,'newInput':'frozen','afterRestart':'absent; Main retains original input, no blind replay'})
 result={'passed':True,'scope':'real native and real fs; synthetic Main decision only; not Flow Session integration','scenes':scenes};(root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({'evidence':str(root),'result':result}))
if __name__=='__main__':main()
