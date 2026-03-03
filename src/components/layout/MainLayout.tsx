import Sidebar from "./Sidebar";
import ChatWindow from "../chat/ChatWindow";

export default function MainLayout() {
  return (
    <div className="app-container">
      <Sidebar />
      <ChatWindow />
    </div>
  );
}
