import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, User, MessageSquare, Settings, LayoutDashboard, X } from "lucide-react";
import OpenAI from "openai";
import "./App.css";

interface Message {
  id: string;
  type: "user" | "agent";
  content: string;
  isLoading?: boolean;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "agent",
      content: "안녕하세요! 원하시는 작업을 말씀해 주세요. 어떤 것을 도와드릴까요? 😊",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [tempApiKey, setTempApiKey] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load API key on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("openai_api_key");
    if (savedKey) {
      setApiKey(savedKey);
      setTempApiKey(savedKey);
    } else {
      setIsSettingsOpen(true); // Open settings automatically if no key found
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSaveSettings = () => {
    setApiKey(tempApiKey);
    localStorage.setItem("openai_api_key", tempApiKey);
    setIsSettingsOpen(false);
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    if (!apiKey) {
      alert("OpenAI API 키를 먼저 설정해 주세요.");
      setIsSettingsOpen(true);
      return;
    }

    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue,
    };

    // Add loading agent message
    const loadingId = (Date.now() + 1).toString();
    const loadingMsg: Message = {
      id: loadingId,
      type: "agent",
      content: "생각 중...",
      isLoading: true
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInputValue("");

    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true // Required for client-side API calls
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // or gpt-4 or whatever user prefers
        messages: [
          { role: "system", content: "You are a helpful and fully capable desktop AI assistant. Reply in a concise, friendly manner. Respond in the same language as the user's prompt (usually Korean)." },
          // Include history (last 5 messages for context)
          ...messages.slice(-5).filter(m => !m.isLoading).map(m => ({
            role: m.type === "user" ? "user" as const : "assistant" as const,
            content: m.content
          })),
          { role: "user", content: inputValue }
        ]
      });

      const replyContent = response.choices[0]?.message?.content || "응답을 받지 못했습니다.";

      // Replace loading message with actual response
      setMessages((prev) =>
        prev.map(msg =>
          msg.id === loadingId
            ? { ...msg, content: replyContent, isLoading: false }
            : msg
        )
      );
    } catch (error) {
      console.error("OpenAI API Error:", error);
      setMessages((prev) =>
        prev.map(msg =>
          msg.id === loadingId
            ? { ...msg, content: "API 호출 중 오류가 발생했습니다. API 키가 정확한지 확인해 주세요.", isLoading: false }
            : msg
        )
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render loading indicator for agents
  const renderMessageContent = (msg: Message) => {
    if (msg.isLoading) {
      return (
        <span className="loading-dots">
          <span></span><span></span><span></span>
        </span>
      );
    }
    return msg.content;
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">
            <Bot size={24} />
          </div>
          <h1>Agent Workspace</h1>
        </div>

        <div className="sidebar-content">
          <div className="menu-item active">
            <MessageSquare size={20} />
            <span>새 대화 시작</span>
          </div>
          <div className="menu-item">
            <LayoutDashboard size={20} />
            <span>대시보드</span>
          </div>
          <div
            className="menu-item"
            style={{ marginTop: 'auto', position: 'absolute', bottom: '20px', width: '248px' }}
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings size={20} />
            <span>설정</span>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="main-area">
        <header className="chat-header">
          <div className="header-title">업무 보조 에이전트</div>
        </header>

        <div className="chat-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.type} ${msg.isLoading ? 'loading' : ''}`}>
              <div className="avatar">
                {msg.type === "agent" ? <Bot size={22} color="#6366f1" /> : <User size={22} />}
              </div>
              <div className="bubble">
                {renderMessageContent(msg)}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-container">
            <input
              type="text"
              className="chat-input"
              placeholder="메시지를 입력하세요..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="send-button"
              onClick={handleSend}
              disabled={!inputValue.trim() || messages.some(m => m.isLoading)}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>
                <Settings size={24} color="#6366f1" />
                환경 설정
              </h2>
              <button className="close-button" onClick={() => setIsSettingsOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="apiKey">OpenAI API Key</label>
                <input
                  id="apiKey"
                  type="password"
                  placeholder="sk-..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                />
                <p className="form-text">
                  API 키는 기기의 로컬 스토리지에만 안전하게 저장되며 외부로 전송되지 않습니다.
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsSettingsOpen(false)}>
                취소
              </button>
              <button className="btn-primary" onClick={handleSaveSettings}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
