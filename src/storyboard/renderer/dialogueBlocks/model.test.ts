import { describe, expect, it } from "vitest";
import { caretJumped, caretRange, createTypingGroup, dialogueKeyAction, splitBlock, insertSoftBreak, moveCommit, publishesTyping } from "./model";

describe("dialogue block editing", () => {
  const block = {id:"first",shotId:"a",text:"你听见了吗"};
  it.each([
    [3,5,"你听见",""], [0,5,"",""], [5,5,"你听见了吗",""], [1,3,"你","了吗"]
  ] as const)("Enter replaces selection %i..%i", (start,end,left,right) => {
    const parts = splitBlock(block,caretRange(block.text,start,end),()=>"new");
    expect(parts.map(p=>p.text)).toEqual([left,right]);
    expect(new Set(parts.map(p=>p.id))).toEqual(new Set(["first","new"]));
  });
  it("keeps selected-text replacement within one block on Shift+Enter",()=>{
    expect(insertSoftBreak(block.text,caretRange(block.text,1,3))).toEqual({text:"你\n了吗",caret:2});
  });
  it("does not split during IME candidate confirmation",()=>{
    expect(dialogueKeyAction({key:"Enter",nativeEvent:{isComposing:true}})).toBe("none");
    expect(dialogueKeyAction({key:"Enter",keyCode:229})).toBe("none");
  });
  it("expresses a cross-board insertion in one move",()=>{
    expect(moveCommit("b","first","anchor")).toEqual({kind:"moveDialogues",dialogueIds:["first"],targetShotId:"b",beforeId:"anchor"});
  });
});

describe("dialogue typing run boundaries", () => {
  it("treats only a moved selection over unchanged text as a deliberate jump", () => {
    const base = { value: "你听见了吗", start: 3, end: 3 };
    expect(caretJumped(base, { ...base, start: 1, end: 1 })).toBe(true);
    expect(caretJumped(base, { ...base, start: 3, end: 5 })).toBe(true);
    // A keystroke changes the text as well as the caret: never a jump.
    expect(caretJumped(base, { value: "你听见了吗？", start: 4, end: 4 })).toBe(false);
    expect(caretJumped(base, base)).toBe(false);
  });

  it("keeps composition text local until the IME commits it", () => {
    expect(publishesTyping(true, true)).toBe(false);
    expect(publishesTyping(true, false)).toBe(false);
    expect(publishesTyping(false, true)).toBe(false);
    expect(publishesTyping(false, false)).toBe(true);
  });

  it("mints a token the core accepts", () => {
    expect(createTypingGroup()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
