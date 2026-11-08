import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {temporaryWorkspace} from '../../../../test/temporaryWorkspace';
import {createWorkspaceRecoveryBudget} from './workspaceBudget';
it('atomically reserves one shared allowance and supports unknown to exact idempotent settlement',async()=>{
 const root=await temporaryWorkspace('workspace-budget-'),b=await createWorkspaceRecoveryBudget({root,maxRecoveryBytes:100});const results=await Promise.allSettled([b.reserve({operationId:'source',bytes:60,purpose:'source'}),b.reserve({operationId:'output',bytes:60,purpose:'output'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const grant=results.find(r=>r.status==='fulfilled')!;if(grant.status!=='fulfilled')throw Error('grant');await grant.value.retainUnknown();expect(b.snapshot()).toMatchObject({actual:0,reserved:60,unknown:['source']});await grant.value.settleActual(30);await grant.value.settleActual(30);expect(b.actualBytes).toBe(30);expect(b.reservedBytes).toBe(0);await expect(grant.value.settleActual(31)).rejects.toThrow('conflict');
});
it('counts the entire recovery namespace and makes whole-stage custody measurable before audit',async()=>{
 const root=await temporaryWorkspace('workspace-budget-stage-');await fs.mkdir(path.join(root,'.storyboard-flow'));await fs.writeFile(path.join(root,'.storyboard-flow','prior'),Buffer.alloc(20));const b=await createWorkspaceRecoveryBudget({root,maxRecoveryBytes:100});const grant=await b.reserve({operationId:'whole-stage',bytes:80,purpose:'creation'});await fs.writeFile(path.join(root,'.storyboard-flow','new'),Buffer.alloc(50));await expect(b.audit()).rejects.toMatchObject({code:'busy'});const measured=await b.measureActual();expect(measured).toBe(70);await grant.settleActual(measured-b.actualBytes);await b.audit();expect(b.actualBytes).toBe(70);await expect(b.reserve({operationId:'over',bytes:31,purpose:'native'})).rejects.toMatchObject({code:'resource-limit'});
});
it('rejects unsafe retained entries and blocks admission after an expenditure exceeds its grant',async()=>{
 const root=await temporaryWorkspace('workspace-budget-unsafe-'),b=await createWorkspaceRecoveryBudget({root,maxRecoveryBytes:100}),g=await b.reserve({operationId:'g',bytes:10,purpose:'input'});await expect(g.settleActual(11)).rejects.toMatchObject({code:'conflict'});await expect(b.reserve({operationId:'new',bytes:1,purpose:'input'})).rejects.toMatchObject({code:'busy'});await fs.mkdir(path.join(root,'.storyboard-flow'));await fs.symlink(root,path.join(root,'.storyboard-flow','alias'));await expect(b.measureActual()).rejects.toThrow('symlink');
});
