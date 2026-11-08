import type {ImageFrameHeader,FrameIdentity} from '../../../drawing/renderer/image-engine/frames.js';
import type {ImageWorkspaceOwner} from '../../../platform/contracts/imageWorkspace.js';
import type {NativeImageRef} from '../../../platform/contracts/imageProject.js';
export type WorkspaceDisplayStamp={generation:number;identity:FrameIdentity;frameSeq:number};
/** A validated display frame is evidence of temporary display context only.
 * Native versions/project/history remain separate Main decisions. */
export function nextWorkspaceDisplayStamp(input:{owner:ImageWorkspaceOwner;ref:NativeImageRef;generation:number;prior?:WorkspaceDisplayStamp;header:ImageFrameHeader;envelope:Record<string,unknown>}):WorkspaceDisplayStamp|null{
 const {owner,ref,generation,prior,header:h,envelope}=input;
 if(h.sessionId!==owner.sessionId||h.incarnation!==owner.incarnation||h.documentId!==ref.documentId||h.width!==ref.width||h.height!==ref.height||h.workerEpoch!==envelope.workerEpoch||h.sessionId!==envelope.sessionId||h.incarnation!==envelope.incarnation)return null;
 if(prior&&(generation<prior.generation||generation===prior.generation&&(h.workerEpoch!==prior.identity.workerEpoch||h.epoch<prior.identity.epoch||h.epoch===prior.identity.epoch&&h.frameSeq<=prior.frameSeq)))return null;
 return{generation,identity:{sessionId:h.sessionId,incarnation:h.incarnation,documentId:h.documentId,workerEpoch:h.workerEpoch,epoch:h.epoch},frameSeq:h.frameSeq};
}
