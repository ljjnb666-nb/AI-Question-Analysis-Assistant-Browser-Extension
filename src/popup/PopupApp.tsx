import React, { useEffect, useState } from "react";
import { sendToActiveTab } from "@/shared/utils/messaging";
import { getProviderShortName } from "@/shared/ai/providers";

export const PopupApp: React.FC = () => {
  const [status, setStatus] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerId, setProviderId] = useState("anthropic");
  const [providerName, setProviderName] = useState("Claude");
  const [loaded, setLoaded] = useState(false);
  const [activeFeature, setActiveFeature] = useState<"manual" | "auto" | "fullpage" | null>(null);

  useEffect(() => {
    chrome.storage.local.get("appSettings").then((r) => {
      const settings = (r.appSettings as {
        apiKey?: string;
        providerId?: string;
      } | undefined) ?? {};
      const key = settings.apiKey ?? "";
      const pid = settings.providerId ?? "anthropic";
      setApiKey(key);
      setProviderId(pid);
      setProviderName(getProviderShortName(pid));
      setLoaded(true);
    });
  }, []);

  const hasApiKey = apiKey.length > 0 || providerId === "ollama";

  const openSidePanelDirect = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (err) {
      console.error("[Popup] sidePanel.open failed:", err);
    }
  };

  const handleManualCapture = async () => {
    try {
      setActiveFeature("manual");
      setStatus("启动截图中...");
      await sendToActiveTab({ type: "START_MANUAL_CAPTURE" });
      window.close();
    } catch {
      setStatus("无法注入页面，请刷新页面后重试");
      setActiveFeature(null);
    }
  };

  const handleAutoDetect = async () => {
    try {
      setActiveFeature("auto");
      setStatus("识别中...");
      await openSidePanelDirect();
      await sendToActiveTab({ type: "START_AUTO_DETECT" });
      window.close();
    } catch {
      setStatus("无法识别，请刷新页面后重试");
      setActiveFeature(null);
    }
  };

  const handleFullPageDetect = async () => {
    try {
      setActiveFeature("fullpage");
      setStatus("整页扫描中...");
      await openSidePanelDirect();
      await sendToActiveTab({ type: "START_FULL_PAGE_DETECT" });
      window.close();
    } catch {
      setStatus("无法启动整页扫描，请刷新页面后重试");
      setActiveFeature(null);
    }
  };

  const handleOpenSidePanel = async () => {
    await openSidePanelDirect();
    window.close();
  };

  return (
    <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10, minWidth: 240, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 22 }}>📘</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#cba6f7" }}>题目解析助手</div>
          <div style={{ fontSize: 11, color: "#585b70" }}>截图识题 · 即时解析</div>
        </div>
        {loaded && !hasApiKey && (
          <div
            style={{
              marginLeft: "auto",
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 8,
              backgroundColor: "#2c1f00",
              color: "#f9e2af",
              border: "1px solid #7c5c00",
              whiteSpace: "nowrap",
            }}
          >
            Demo 模式
          </div>
        )}
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #313244" }} />

      <SecondaryBtn onClick={handleManualCapture} active={activeFeature === "manual"}>📸 手动截图（框选题目）</SecondaryBtn>
      <SecondaryBtn onClick={handleAutoDetect} active={activeFeature === "auto"}>🔍 自动识别当前屏题目</SecondaryBtn>
      <SecondaryBtn onClick={handleFullPageDetect} active={activeFeature === "fullpage"}>🧾 自动识别整页题目</SecondaryBtn>

      <hr style={{ border: "none", borderTop: "1px solid #313244" }} />

      <SmallBtn onClick={handleOpenSidePanel}>📋 候选列表 / 设置</SmallBtn>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#585b70" }}>
        <span>v0.2.0</span>
        <span style={{ color: hasApiKey ? "#a6e3a1" : "#585b70" }}>
          {loaded
            ? hasApiKey
              ? `已连接 ${providerName}`
              : "未设置 API Key"
            : "加载中..."}
        </span>
      </div>

      <div style={{ fontSize: 10, color: "#45475a", borderTop: "1px solid #313244", paddingTop: 7 }}>
        快捷键：
        <code style={{ backgroundColor: "#313244", padding: "1px 4px", borderRadius: 3, fontSize: 10, color: "#89b4fa" }}>Alt+Q</code>
        {" 截图 · "}
        <code style={{ backgroundColor: "#313244", padding: "1px 4px", borderRadius: 3, fontSize: 10, color: "#89b4fa" }}>Alt+W</code>
        {" 自动识题"}
      </div>

      {status && (
        <div style={{ fontSize: 11, color: "#f9e2af", textAlign: "center" }}>{status}</div>
      )}
    </div>
  );
};

const SecondaryBtn: React.FC<{ children: React.ReactNode; onClick: () => void; active?: boolean }> = ({ children, onClick, active }) => (
  <button
    onClick={onClick}
    style={{
      width: "100%",
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #4f9cf9",
      backgroundColor: active ? "#4f9cf9" : "transparent",
      color: active ? "#fff" : "#4f9cf9",
      cursor: "pointer",
      fontSize: 13,
      textAlign: "left",
      fontFamily: "inherit",
      transition: "background-color 0.2s, color 0.2s",
    }}
  >
    {children}
  </button>
);

const SmallBtn: React.FC<{ children: React.ReactNode; onClick: () => void }> = ({ children, onClick }) => (
  <button
    onClick={onClick}
    style={{
      width: "100%",
      padding: "7px 10px",
      borderRadius: 7,
      border: "1px solid #313244",
      backgroundColor: "transparent",
      color: "#a6adc8",
      cursor: "pointer",
      fontSize: 12,
      fontFamily: "inherit",
    }}
  >
    {children}
  </button>
);
