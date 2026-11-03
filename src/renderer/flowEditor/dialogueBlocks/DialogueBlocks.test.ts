import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {DialogueBlocks} from './DialogueBlocks';
const base={shotId:'a',dialogues:[{id:'d1',shotId:'a',text:'第一段'}],onCommit:()=>{}};
const render=(props:Record<string,unknown>={})=>renderToStaticMarkup(createElement(DialogueBlocks,{...base,...props} as never));
describe('dialogue block captions',()=>{
 it('labels the full editor so the host needs no separate caption beside its other field',()=>{
  const html=render();
  expect(html).toContain('class="flow-dialogue-heading"');
  expect(html).toContain('台词');
 });
 it('keeps the caption out of the compact letterbox overlay',()=>{
  expect(render({variant:'compact'})).not.toContain('flow-dialogue-heading');
 });
 it('keeps one caption above every row of a multi-block board',()=>{
  const html=render({dialogues:[{id:'d1',shotId:'a',text:'第一段'},{id:'d2',shotId:'a',text:'第二段'}]});
  expect(html.match(/flow-dialogue-heading/g)).toHaveLength(1);
  expect(html.match(/data-block-id=/g)).toHaveLength(2);
 });
});
