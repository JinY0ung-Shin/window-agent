import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ChatPage } from "./pages/ChatPage";
import { useUiStore } from "./stores/uiStore";
import { useChatStore } from "./stores/chatStore";
import "./index.css";

function AppRoutes() {
  const { activePage, setActivePage } = useUiStore();
  const initStreamListener = useChatStore((s) => s.initStreamListener);

  useEffect(() => {
    initStreamListener();
  }, [initStreamListener]);

  useEffect(() => {
    const path = window.location.pathname.replace("/", "") || "dashboard";
    if (path === "dashboard" || path === "chat") {
      setActivePage(path);
    }
  }, [setActivePage]);

  useEffect(() => {
    const current = window.location.pathname.replace("/", "");
    if (current !== activePage) {
      window.history.pushState(null, "", `/${activePage}`);
    }
  }, [activePage]);

  return (
    <MainLayout>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </MainLayout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
