import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ChatPage } from "./pages/ChatPage";
import { HRPage } from "./pages/HRPage";
import { TaskBoardPage } from "./pages/TaskBoardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { OrgChartPage } from "./pages/OrgChartPage";
import { useUiStore, type Page } from "./stores/uiStore";
import { useChatStore } from "./stores/chatStore";
import "./index.css";

const validPages: Page[] = ["dashboard", "chat", "hr", "tasks", "settings", "reports", "orgchart"];

function AppRoutes() {
  const { activePage, setActivePage } = useUiStore();
  const initStreamListener = useChatStore((s) => s.initStreamListener);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    initStreamListener();
  }, [initStreamListener]);

  useEffect(() => {
    const path = location.pathname.replace("/", "") || "dashboard";
    if (validPages.includes(path as Page)) {
      setActivePage(path as Page);
    }
  }, [location.pathname, setActivePage]);

  useEffect(() => {
    const current = location.pathname.replace("/", "");
    if (current !== activePage) {
      navigate(`/${activePage}`, { replace: true });
    }
  }, [activePage, location.pathname, navigate]);

  return (
    <MainLayout>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/hr" element={<HRPage />} />
        <Route path="/tasks" element={<TaskBoardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/orgchart" element={<OrgChartPage />} />
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
