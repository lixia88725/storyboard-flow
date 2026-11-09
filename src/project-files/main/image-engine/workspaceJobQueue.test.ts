import{it,expect}from'vitest';
import{createWorkspaceJobQueue}from'./workspaceJobQueue';
it('reprioritizes waiting work and gives the oldest job a turn under foreground pressure',async()=>{
 const q=createWorkspaceJobQueue(),order:string[]=[];let release!:()=>void;
 const blocker=q.run(()=>0,()=>new Promise<void>(r=>{release=r;}));await Promise.resolve();
 let visible=false;const tasks=[q.run(()=>2,async()=>{order.push('oldest');}),q.run(()=>visible?0:2,async()=>{order.push('visible');})];
 for(let i=0;i<8;i++)tasks.push(q.run(()=>1,async()=>{order.push('foreground');}));
 visible=true;release();await blocker;await Promise.all(tasks);
 expect(order[0]).toBe('visible');expect(order.indexOf('oldest')).toBeLessThanOrEqual(4);expect(order).toHaveLength(10);
});
it('continues after a rejected job and settles every waiting promise',async()=>{
 const q=createWorkspaceJobQueue(),failure=q.run(()=>0,async()=>{throw Error('local');}),next=q.run(()=>1,async()=>42);
 await expect(failure).rejects.toThrow('local');await expect(next).resolves.toBe(42);
});
