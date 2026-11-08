import { NativeFlowEditor } from "./image-engine/NativeFlowEditor";
import { FlowEditor } from "./FlowEditor";
import { createRoot } from "react-dom/client";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const view=createRoot(root);
view.render(<div role="status" style={{padding:24}}>正在打开 Storyboard Flow…</div>);
// Main chooses the engine. Never guess from a folder name or reinterpret a V1
// bootstrap as a native Session when the bridge is unavailable.
void window.flowEditor.launcherState().then(state=>{
  view.render(state.engine==='native'?<NativeFlowEditor/>:<FlowEditor/>);
},()=>view.render(<div role="alert" style={{padding:24}}>无法连接项目窗口。请保留项目文件夹，关闭窗口后重新启动。</div>));
