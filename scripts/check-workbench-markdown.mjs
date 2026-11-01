import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatScript} from './export-workbench-markdown.mjs';

test('export follows board and dialogue order, preserves multiline text, excludes Pending',()=>{
  const script=formatScript({name:'雨',shots:[{id:'b',name:'B',scriptText:'抬头\n敲门'},{id:'a',name:'A',scriptText:''}],
    parkedShots:[{id:'c',name:'C',scriptText:'备选'}],dialogues:[
      {shotId:'b',text:'谁？'},{shotId:'c',text:'隐藏'},{shotId:'b',text:'是我。'}]});
  assert.match(script,/001 · B[\s\S]+抬头\n敲门[\s\S]+谁？[\s\S]+是我。[\s\S]+002 · A/);
  assert.doesNotMatch(script,/备选|隐藏/);
});
