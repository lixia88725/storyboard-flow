import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {CanvasPresentationContext} from '../../canvasPresentation';
import {BoardDialogue} from './BoardDialogue';
const props={shotId:'a',width:640,height:360,editing:false,disabled:false,editor:createElement('textarea',{defaultValue:'one\ntwo'}),begin:()=>true,end:()=>{}};
function render(dialogue:boolean,editing=false){return renderToStaticMarkup(createElement(CanvasPresentationContext.Provider,{value:{a:{mode:'expanded',dialogue,text:'one two'}}},createElement(BoardDialogue,{...props,editing})));}
describe('board dialogue input admission',()=>{
 it('does not intercept cards whose dialogue overlay is off',()=>expect(render(false)).toBe(''));
 it('leaves idle presentation text to the existing overlay without mounting an editor',()=>{const html=render(true);expect(html).toContain('编辑故事板台词 a');expect(html).not.toContain('<textarea');expect(html).not.toContain('one');});
 it('mounts one editor retaining multiline dialogue only for the editing card',()=>{const html=render(true,true);expect(html.match(/<textarea/g)).toHaveLength(1);expect(html).toContain('one\ntwo');});
});
