import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Button } from "./ui/button";
import { X, ChevronDown, Settings, User, Download, Terminal, Database, Brain, Sparkles, Menu, ChevronUp, Upload, MoreHorizontal, LogOut, LayoutDashboard, History, Zap, Cpu, Layers, HardDrive, Network, RefreshCw, Search, Plus, Trash2, Archive, ArrowUpRight, ExternalLink, Copy, Loader2, MessageSquare, Bot, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Minimize, Maximize2, Grid, List, FileText, Image, Paperclip, Send, Mic, MicOff, Volume2, VolumeX, Eye, EyeOff, Lock, Unlock, Key, Shield, AlertTriangle, CheckCircle, XCircle, Info, HelpCircle, Bell, BellOff, Moon, Sun, Globe, Languages, Palette, SlidersHorizontal, ToggleLeft, ToggleRight, ChevronDown as ChevronDownIcon, ChevronUp as ChevronUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";

type PageId = "chat" | "terminal" | "provider" | "settings" | "memory" | "profile";

const PAGE_LABELS: Record<PageId, { ru: string; en: string; icon: React.ReactNode }> = {
  chat: { ru: "Чат", en: "Chat", icon: <MessageSquare className="size-5" /> },
  terminal: { ru: "Терминал", en: "Terminal", icon: <Terminal className="size-5" /> },
  provider: { ru: "API-чат", en: "API Chat", icon: <Network className="size-5" /> },
  settings: { ru: "Настройки", en: "Settings", icon: <Settings className="size-5" /> },
  memory: { ru: "Память", en: "Memory", icon: <Brain className="size-5" /> },
  profile: { ru: "Профиль", en: "Profile", icon: <User className="size-5" /> },
};

const MODEL_OPTIONS = [
  { id: "flash", label: { ru: "Kairema Flash", en: "Kairema Flash" }, desc: { ru: "Быстрые ответы · сбалансированный режим", en: "Fast answers · balanced mode" }, symbol: "✳" },
  { id: "think", label: { ru: "Kairema Think", en: "Kairema Think" }, desc: { ru: "Глубокие рассуждения · сложные задачи", en: "Deep reasoning · complex tasks" }, symbol: "◈" },
  { id: "context", label: { ru: "Kairema Context", en: "Kairema Context" }, desc: { ru: "Большой контекст · длинные документы", en: "Large context · long documents" }, symbol: "▤" },
  { id: "apex", label: { ru: "Kairema Apex", en: "Kairema Apex" }, desc: { ru: "Максимум возможностей · сложные запросы", en: "Maximum capabilities · complex requests" }, symbol: "✦" },
];

export function AppLayout({ children, activePage, onPageChange, modelId, onModelChange, onNewChat, onExport, onSettings, onProfile, sidebarOpen, setSidebarOpen, user, isAuthenticated, language }: {
  children: React.ReactNode;
  activePage: PageId;
  onPageChange: (page: PageId) => void;
  modelId: string;
  onModelChange: (modelId: string) => void;
  onNewChat: () => void;
  onExport: (format: string) => void;
  onSettings: () => void;
  onProfile: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  user: { name?: string; email?: string; isGuest?: number } | null;
  isAuthenticated: boolean;
  language: "ru" | "en";
}) {
  const t = language === "ru" ? "Русский" : "English";
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  const currentModel = MODEL_OPTIONS.find(m => m.id === modelId) || MODEL_OPTIONS[0];
  const userName = user?.name || (language === "ru" ? "Гость" : "Guest");
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(event.target as Node) &&
          modelPickerTriggerRef.current && !modelPickerTriggerRef.current.contains(event.target as Node)) {
        setModelPickerOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node) &&
          exportTriggerRef.current && !exportTriggerRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 680) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setModelPickerOpen(false);
      setExportMenuOpen(false);
      setSidebarOpen(false);
    }
  };

  return (
    <div className="app" onKeyDown={handleKeyDown}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} id="sidebar" role="navigation" aria-label={language === "ru" ? "Боковая панель" : "Sidebar"}>
        <div className="brand">
          <div className="mark" aria-hidden="true">K</div>
          <div>
            <b>KAIREMA</b>
            <small>AI WORKSPACE</small>
          </div>
        </div>
        <button className="new" id="newChat" onClick={onNewChat} aria-label={language === "ru" ? "Новый чат" : "New chat"}>
          <Plus className="size-4" aria-hidden="true" />{"\u3000"}{language === "ru" ? "Новый чат" : "New chat"}
        </button>
        <div className="label">{language === "ru" ? "История чатов" : "Chat history"}</div>
        <div className="history" id="history" role="list" aria-label={language === "ru" ? "История чатов" : "Chat history"}>
          <div className="history-empty" style={{ padding: "12px", color: "var(--muted)", fontSize: "12px", textAlign: "center" }}>
            {language === "ru" ? "История пока пуста." : "No chat history yet."}
          </div>
        </div>
        <div className="side-links">
          <div className="label">{language === "ru" ? "Рабочее пространство" : "Workspace"}</div>
          {(
            [
              { id: "provider", icon: <Network className="size-4" /> },
              { id: "memory", icon: <Brain className="size-4" /> },
              { id: "terminal", icon: <Terminal className="size-4" /> },
              { id: "settings", icon: <Settings className="size-4" /> },
              { id: "profile", icon: <User className="size-4" /> },
            ] as const
          ).map(({ id, icon }) => (
            <button
              key={id}
              className={`side-link ${activePage === id ? "active" : ""}`}
              data-page={id}
              onClick={() => onPageChange(id as PageId)}
              aria-current={activePage === id ? "page" : undefined}
            >
              {icon}{"\u3000"}language === "ru" ? PAGE_LABELS[id as PageId].ru : PAGE_LABELS[id as PageId].en
            </button>
          ))}
        </div>
        <div className="sidebottom">
          <div className="avatar" aria-hidden="true">{userInitial}</div>
          <div className="usermeta">
            <b id="sideName">{userName}</b>
            <small>{userEmail || (language === "ru" ? "Гостевой режим" : "Guest mode")}</small>
          </div>
          <button className="icon" id="profileSide" aria-label={language === "ru" ? "Профиль" : "Profile"} onClick={onProfile}>
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </aside>

      <div className="scrim" id="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <main className="main">
        <header className="topbar" role="banner">
          <div className="top-left" id="topLeft">
            <button className="icon mobilemenu" id="mobileMenu" onClick={toggleSidebar} aria-label={sidebarOpen ? (language === "ru" ? "Закрыть меню" : "Close menu") : (language === "ru" ? "Открыть меню" : "Open menu")} aria-expanded={sidebarOpen}>
              <Menu className="size-5" />
            </button>

            <div className="model-picker-wrap" ref={modelPickerRef}>
              <button
                ref={modelPickerTriggerRef}
                className="model-picker"
                id="modelPicker"
                aria-expanded={modelPickerOpen}
                aria-haspopup="listbox"
                aria-label={language === "ru" ? "Выбрать модель" : "Select model"}
                onClick={() => setModelPickerOpen(!modelPickerOpen)}
              >
                <span className="picker-symbol" id="pickerSymbol" aria-hidden="true">{currentModel.symbol}</span>
                <span className="picker-copy">
                  <small>{language === "ru" ? "АКТИВНАЯ МОДЕЛЬ" : "ACTIVE MODEL"}</small>
                  <b id="modelPickerName">{currentModel.label[language]}</b>
                  <em id="modelPickerDesc">{currentModel.desc[language]}</em>
                </span>
                <span className="picker-chevron" aria-hidden="true">
                  <ChevronDownIcon className="size-5" />
                </span>
              </button>

              <div className="model-popover" id="modelPopover" hidden={!modelPickerOpen} role="listbox" aria-label={language === "ru" ? "Выбор модели" : "Model selection"}>
                <div className="popover-title">
                  <b>{language === "ru" ? "Выберите модель" : "Select model"}</b>
                  <span>{language === "ru" ? "Режим ответа Kairema" : "Kairema response mode"}</span>
                </div>
                <div className="model-switch" id="modelSwitch" role="group" aria-label={language === "ru" ? "Выбор модели" : "Model selection"}>
                  {MODEL_OPTIONS.map((model) => (
                    <button
                      key={model.id}
                      className={`model-option ${model.id === modelId ? "selected" : ""}`}
                      data-model={model.id}
                      role="option"
                      aria-selected={model.id === modelId}
                      onClick={() => { onModelChange(model.id); setModelPickerOpen(false); }}
                    >
                      <span className="model-symbol" aria-hidden="true">{model.symbol}</span>
                      <span>
                        <b>{model.label[language]}</b>
                        <small>{model.desc[language]}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="topactions">
            <div className="exportwrap">
              <button
                ref={exportTriggerRef}
                className="topact"
                id="exportBtn"
                aria-label={language === "ru" ? "Экспорт" : "Export"}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                onClick={(e) => { e.stopPropagation(); setExportMenuOpen(!exportMenuOpen); }}
              >
                <Download className="size-4" aria-hidden="true" />
                <span className="txt">{language === "ru" ? "Экспорт" : "Export"}</span>
              </button>
              <div className="menu" id="exportMenu" hidden={!exportMenuOpen} role="menu" aria-label={language === "ru" ? "Экспорт" : "Export"}>
                <button role="menuitem" onClick={() => { onExport("markdown"); setExportMenuOpen(false); }}>
                  <span className="export-icon md-icon"><FileText className="size-3" /></span>
                  <span><b>{language === "ru" ? "Markdown" : "Markdown"}</b><small>{language === "ru" ? ".md · текстовый файл" : ".md · text file"}</small></span>
                </button>
                <button role="menuitem" onClick={() => { onExport("pdf"); setExportMenuOpen(false); }}>
                  <span className="export-icon pdf-icon"><FileText className="size-3" /></span>
                  <span><b>{language === "ru" ? "PDF" : "PDF"}</b><small>{language === "ru" ? "Печать или сохранить" : "Print or save"}</small></span>
                </button>
              </div>
            </div>
            <button className="icon settings-short" id="settingsTop" title={language === "ru" ? "Настройки" : "Settings"} onClick={onSettings} aria-label={language === "ru" ? "Настройки" : "Settings"}>
              <Settings className="size-4" />
            </button>
            <button className="icon" id="profileTop" title={language === "ru" ? "Профиль" : "Profile"} onClick={onProfile} aria-label={language === "ru" ? "Профиль" : "Profile"}>
              <User className="size-4" />
            </button>
          </div>
        </header>

        <div className="scroll" id="scroll">
          <div className="workspace">
            {children}
          </div>
        </div>


      </main>

      <nav className="bottomnav" id="bottomnav" aria-label={language === "ru" ? "Основная навигация" : "Main navigation"}>
        {(
          ["chat", "provider", "terminal", "settings", "profile"] as PageId[]
        ).map((page) => (
          <button
            key={page}
            data-page={page}
            className={activePage === page ? "active" : ""}
            onClick={() => onPageChange(page)}
            aria-current={activePage === page ? "page" : undefined}
          >
            <span aria-hidden="true">{PAGE_LABELS[page].icon}</span>
            <span>language === "ru" ? PAGE_LABELS[page].ru : PAGE_LABELS[page].en</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
