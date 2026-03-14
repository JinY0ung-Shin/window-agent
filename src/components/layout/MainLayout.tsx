import { Bug } from "lucide-react";
import Sidebar from "./Sidebar";
import ChatWindow from "../chat/ChatWindow";
import DebugPanel from "../debug/DebugPanel";
import { useDebugStore } from "../../stores/debugStore";

export default function MainLayout() {
  const isDebugOpen = useDebugStore((s) => s.isOpen);
  const setDebugOpen = useDebugStore((s) => s.setOpen);

  return (
    <div className="app-container">
      <Sidebar />
      <ChatWindow />
      <button
        className="debug-toggle-btn"
        onClick={() => setDebugOpen(!isDebugOpen)}
        title="도구 로그"
      >
        <Bug size={18} />
      </button>
      <DebugPanel />
    </div>
  );
}
