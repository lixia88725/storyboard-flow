import type {CreateBlankProject,CreateImageProject,CreateImageProjectOptions} from '../../../platform/contracts/flowProjectCreation.js';
import type {TiffCodec} from '../formats/index.js';
import type {WorkspaceOutputBudget} from './workspaceOutputContract.js';

export type WorkspaceUpgradeInspection={sourceRoot:string;projectId:string;projectName:string;folderName:string;activeBoards:number;pendingBoards:number;sourceDigest:string;projectHash:string;issues:{code:string;message:string}[]};
export type WorkspaceCopyUpgradeInput={operationId:string;sourceRoot:string;projectId:string;sourceDigest:string;destinationParent:string;folderName:string;projectName:string};
export type WorkspaceCreationBudget=WorkspaceOutputBudget&{audit():Promise<void>};
export type WorkspaceCreationOptions={
 leaseBinary:string;maxRecoveryBytes?:number;
 /** One broker for all writers in this new private workspace. The factory is
  * opened before any recovery expenditure and receives an empty private root. */
 budgetFactory(input:{root:string;maxRecoveryBytes:number}):Promise<WorkspaceCreationBudget>;
 /** Existing Main readonly project probe; never start a second Session here. */
 prepare?(input:{root:string;projectId:string}):Promise<void>;
 /** Only the explicitly approved V1 upgrade bridge uses this strict layer writer. */
 legacyCodec?:TiffCodec;
 /** Injectable independently implemented layered decoder, required for upgrades.
  * Production supplies readPhotocraft; a fake does not certify fidelity. */
 verifyLegacyLayers?:(input:{bytes:Uint8Array;projectRoot:string;imageId:string})=>Promise<{width:number;height:number;layers:{name:string;visible:boolean;locked:boolean;opacity:number;blendMode:string;png:Uint8Array}[];reference:boolean;warnings:string[]}>;
 fault?:(point:string,input:{stage:string;target:string})=>Promise<void>;
};
export type ImageWorkspaceCreation={
 createBlankProject:CreateBlankProject;
 createImageProject:CreateImageProject;
 inspectUpgrade(sourceRoot:string):Promise<WorkspaceUpgradeInspection>;
 copyUpgrade(input:WorkspaceCopyUpgradeInput,options:CreateImageProjectOptions):Promise<{root:string}>;
};
