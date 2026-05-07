import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FloatingWindowState, ParseResult, QuestionBlock } from "@/shared/types";
import { clampToViewport } from "@/shared/utils/bbox";
import { logEvent } from "@/shared/utils/analytics";

const MIN_W = 320, MIN_H = 180;
const MAX_W_RATIO = 0.7, MAX_H_RATIO = 0.8;
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const SNAP_MARGIN = 12; // px — snap to edge within this distance

interface Props {
  initialState: FloatingWindowState;
  block: QuestionBlock | null;
  result: ParseResult | null;
  loading: boolean;
  error: string | null;
  streamingText: string | null;
  suggestVision: boolean;
  onClose: () => void;
  onRetake: () => void;
  onUpgradeVision: () => void;
  onStateChange: (patch: Partial<FloatingWindowState>) => void;
}

export const FloatingWindow: React.FC<Props> = ({
  initialState, block, result, loading, error, streamingText,
  suggestVision, onClose, onRetake, onUpgradeVision, onStateChange,
}) => {
  const [pos, setPos]         = useState({ x: initialState.x, y: initialState.y });
  const [size, setSize]       = useState({ w: initialState.width, h: initialState.height });
  const [minimized, setMin]   = useState(initialState.minimized);
  const [visible, setVisible] = useState(initialState.visible);
  const [showDetail, setShowDetail] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [copied, setCopied]   = useState(false);

  const dragging    = useRef(false);
  const dragOffset  = useRef({ x: 0, y: 0 });
  const resizing    = useRef<ResizeDir | null>(null);
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, left: 0, top: 0 });

  // Sync visibility from manager
  useEffect(() => {
    setVisible(initialState.visible);
    if (initialState.visible) setMin(initialState.minimized);
  }, [initialState.visible, initialState.minimized]);

  // Persist with debounce
  useEffect(() => {
    const t = setTimeout(() => {
      onStateChange({ x: pos.x, y: pos.y, width: size.w, height: size.h, minimized });
    }, 500);
    return () => clearTimeout(t);
  }, [pos, size, minimized, onStateChange]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const nx = e.clientX - dragOffset.current.x;
      const ny = e.clientY - dragOffset.current.y;
      setPos(clampToViewport(nx, ny, size.w, size.h));
    };
    const onUp = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      // Edge snap
      const nx = e.clientX - dragOffset.current.x;
      const ny = e.clientY - dragOffset.current.y;
      setPos(prev => snapToEdge(prev.x, prev.y, size.w, size.h, nx, ny));
      logEvent("floating_window_moved");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [size]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((dir: ResizeDir, e: React.MouseEvent) => {
    resizing.current = dir;
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.w,
      h: size.h,
      left: pos.x,
      top: pos.y,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [size, pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dir = resizing.current;
      if (!dir) return;
      const start = resizeStart.current;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const maxW = Math.floor(window.innerWidth * MAX_W_RATIO);
      const maxH = Math.floor(window.innerHeight * MAX_H_RATIO);

      let nextW = start.w;
      let nextH = start.h;
      let nextX = start.left;
      let nextY = start.top;

      if (dir.includes("e")) nextW = start.w + dx;
      if (dir.includes("s")) nextH = start.h + dy;
      if (dir.includes("w")) nextW = start.w - dx;
      if (dir.includes("n")) nextH = start.h - dy;

      nextW = Math.max(MIN_W, Math.min(nextW, maxW));
      nextH = Math.max(MIN_H, Math.min(nextH, maxH));

      if (dir.includes("w")) nextX = start.left + (start.w - nextW);
      if (dir.includes("n")) nextY = start.top + (start.h - nextH);

      const clamped = clampToViewport(nextX, nextY, nextW, nextH);
      setSize({ w: nextW, h: nextH });
      setPos({ x: clamped.x, y: clamped.y });
    };
    const onUp = () => {
      if (resizing.current) {
        resizing.current = null;
        logEvent("floating_window_resized");
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleCopy = () => {
    const text = result ? `答案：${result.answer}\n\n${result.briefExplanation}` : "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      logEvent("answer_copied", { blockId: block?.id });
    });
  };

  const handleMinimize = () => { setMin(true); logEvent("floating_window_minimized"); };
  const handleClose    = () => { logEvent("floating_window_closed"); onClose(); };
  const RESIZE_HANDLES: Array<{ dir: ResizeDir; style: React.CSSProperties }> = [
    { dir: "n",  style: { top: -4, left: 10, right: 10, height: 8, cursor: "ns-resize" } },
    { dir: "s",  style: { bottom: -4, left: 10, right: 10, height: 8, cursor: "ns-resize" } },
    { dir: "e",  style: { right: -4, top: 10, bottom: 10, width: 8, cursor: "ew-resize" } },
    { dir: "w",  style: { left: -4, top: 10, bottom: 10, width: 8, cursor: "ew-resize" } },
    { dir: "ne", style: { right: -4, top: -4, width: 12, height: 12, cursor: "nesw-resize" } },
    { dir: "nw", style: { left: -4, top: -4, width: 12, height: 12, cursor: "nwse-resize" } },
    { dir: "se", style: { right: -4, bottom: -4, width: 12, height: 12, cursor: "nwse-resize" } },
    { dir: "sw", style: { left: -4, bottom: -4, width: 12, height: 12, cursor: "nesw-resize" } },
  ];

  if (!visible) return null;

  // ── Minimized pill ────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <div onMouseDown={onHeaderMouseDown} onClick={() => setMin(false)} style={{
        position:"fixed", left:pos.x, top:pos.y, zIndex:initialState.zIndex,
        display:"flex", alignItems:"center", gap:8,
        backgroundColor:"#1e1e2e", color:"#cdd6f4",
        padding:"7px 14px", borderRadius:24,
        boxShadow:"0 2px 14px rgba(0,0,0,0.55)",
        cursor:"pointer", fontSize:13, fontFamily:"system-ui,sans-serif",
        userSelect:"none", border:"1px solid #313244",
      }}>
        <span style={{fontSize:16}}>📘</span>
        <span>
          {loading ? "解析中…" : error ? "⚠️ 解析失败" : result ? `答案：${result.answer}` : "题目解析"}
        </span>
        <button onClick={e=>{e.stopPropagation(); handleClose();}} style={iconBtnStyle}>✕</button>
      </div>
    );
  }

  // ── Full window ───────────────────────────────────────────────────────────
  return (
    <div style={{
      position:"fixed", left:pos.x, top:pos.y, width:size.w, height:size.h,
      zIndex:initialState.zIndex, backgroundColor:"#1e1e2e", borderRadius:12,
      boxShadow:"0 8px 32px rgba(0,0,0,0.6)", display:"flex", flexDirection:"column",
      fontFamily:"system-ui,sans-serif", color:"#cdd6f4", overflow:"hidden",
      boxSizing:"border-box", border:"1px solid #313244",
    }}>
      {/* Header */}
      <div onMouseDown={onHeaderMouseDown} style={{
        padding:"8px 12px", backgroundColor:"#181825",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        cursor:"grab", borderBottom:"1px solid #313244", flexShrink:0, userSelect:"none",
      }}>
        <div style={{display:"flex", alignItems:"center", gap:6}}>
          <span style={{fontSize:16}}>📘</span>
          <span style={{fontSize:13, fontWeight:600, color:"#cba6f7"}}>题目解析助手</span>
          {result && <RouteTag route={result.routeUsed} />}
        </div>
        <div style={{display:"flex", gap:4}}>
          <button onClick={handleMinimize} style={iconBtnStyle} title="最小化">—</button>
          <button onClick={handleClose} style={{...iconBtnStyle, color:"#f38ba8"}} title="关闭">✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{flex:1, overflowY:"auto", padding:"12px 14px"}}>
        {loading && <LoadingState streamingText={streamingText} />}
        {!loading && error && <ErrorState error={error} onRetry={onRetake} />}
        {!loading && !error && !result && <EmptyState />}
        {!loading && !error && result && (
          <>
            {suggestVision && (
              <VisionSuggestion onUpgrade={onUpgradeVision} />
            )}
            <ResultContent
              result={result} block={block}
              showDetail={showDetail} showFeedback={showFeedback}
              onToggleDetail={() => setShowDetail(v=>!v)}
              onToggleFeedback={() => setShowFeedback(v=>!v)}
            />
          </>
        )}
      </div>

      {/* Footer */}
      {result && !loading && !error && (
        <div style={{
          padding:"8px 12px", borderTop:"1px solid #313244",
          display:"flex", gap:6, flexShrink:0, backgroundColor:"#181825", flexWrap:"wrap",
        }}>
          <ActionBtn onClick={handleCopy} primary>{copied ? "✓ 已复制" : "复制答案"}</ActionBtn>
          <ActionBtn onClick={onRetake}>再截一题</ActionBtn>
          <ActionBtn onClick={() => setShowFeedback(v=>!v)}>反馈错误</ActionBtn>
        </div>
      )}
      {error && !loading && (
        <div style={{padding:"8px 12px", borderTop:"1px solid #313244", backgroundColor:"#181825", display:"flex", gap:6}}>
          <ActionBtn onClick={onRetake} primary>重新截图</ActionBtn>
          <ActionBtn onClick={onUpgradeVision}>🖼 图题增强</ActionBtn>
        </div>
      )}

            {/* Resize handles: 4 edges + 4 corners */}
      {RESIZE_HANDLES.map((h) => (
        <div
          key={h.dir}
          onMouseDown={(e) => onResizeMouseDown(h.dir, e)}
          style={{
            position: "absolute",
            zIndex: 2,
            pointerEvents: "all",
            ...h.style,
          }}
        />
      ))}
    </div>
  );
};

// ─── Edge snap helper ─────────────────────────────────────────────────────────
function snapToEdge(px: number, py: number, w: number, h: number, rawX: number, rawY: number) {
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = clampToViewport(rawX, rawY, w, h).x;
  let y = clampToViewport(rawX, rawY, w, h).y;
  if (rawX < SNAP_MARGIN) x = 0;
  if (rawX + w > vw - SNAP_MARGIN) x = vw - w;
  if (rawY < SNAP_MARGIN) y = 0;
  if (rawY + h > vh - SNAP_MARGIN) y = vh - h;
  return { x, y };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const RouteTag: React.FC<{route: string}> = ({route}) => {
  const map: Record<string,[string,string]> = {
    vision:["视觉","#f38ba8"], text:["文字","#89b4fa"], hybrid:["混合","#f9e2af"],
  };
  const [label, color] = map[route] ?? ["?","#6c7086"];
  return (
    <span style={{fontSize:10, padding:"1px 7px", borderRadius:10, backgroundColor:"#313244", color}}>
      {label}链路
    </span>
  );
};

const VisionSuggestion: React.FC<{onUpgrade: () => void}> = ({onUpgrade}) => (
  <div style={{
    padding:"8px 10px", borderRadius:7, marginBottom:10,
    backgroundColor:"#2a1f3d", border:"1px solid #6d28d9",
    display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
  }}>
    <div>
      <div style={{fontSize:12, color:"#c4b5fd", fontWeight:600}}>置信度较低</div>
      <div style={{fontSize:11, color:"#a78bfa"}}>建议切换图题增强（视觉链路）重新解析</div>
    </div>
    <button onClick={onUpgrade} style={{
      padding:"5px 10px", borderRadius:6, border:"none",
      backgroundColor:"#7c3aed", color:"#fff",
      cursor:"pointer", fontSize:11, fontWeight:600, flexShrink:0,
      fontFamily:"system-ui,sans-serif",
    }}>🖼 切换</button>
  </div>
);

const LoadingState: React.FC<{streamingText: string | null}> = ({streamingText}) => (
  <div style={{textAlign:"center", paddingTop:20, color:"#a6adc8"}}>
    <div style={{fontSize:28, marginBottom:8}}>⏳</div>
    <div style={{fontSize:14}}>正在解析题目…</div>
    {streamingText ? (
      <div style={{
        marginTop:10, padding:"8px 10px", borderRadius:6,
        backgroundColor:"#181825", border:"1px solid #313244",
        fontSize:11, color:"#585b70", textAlign:"left",
        maxHeight:80, overflowY:"auto", whiteSpace:"pre-wrap",
        wordBreak:"break-all",
      }}>
        <span style={{color:"#89b4fa", fontWeight:600}}>▍ </span>
        {streamingText}
      </div>
    ) : (
      <div style={{marginTop:6, fontSize:11, color:"#585b70"}}>AI 正在分析截图内容</div>
    )}
  </div>
);

const EmptyState: React.FC = () => (
  <div style={{textAlign:"center", paddingTop:28, color:"#6c7086"}}>
    <div style={{fontSize:28, marginBottom:10}}>🖼️</div>
    <div style={{fontSize:13}}>框选题目区域后点击「解析此题」</div>
  </div>
);

const ErrorState: React.FC<{error: string; onRetry: () => void}> = ({error, onRetry}) => (
  <div style={{textAlign:"center", paddingTop:16}}>
    <div style={{fontSize:24, marginBottom:8}}>⚠️</div>
    <div style={{fontSize:13, marginBottom:10, color:"#f38ba8"}}>解析失败</div>
    <div style={{
      fontSize:11, color:"#585b70", backgroundColor:"#181825",
      padding:"6px 10px", borderRadius:6, marginBottom:12,
      wordBreak:"break-all", maxHeight:72, overflowY:"auto", textAlign:"left",
    }}>{error}</div>
    <ActionBtn onClick={onRetry} primary>重新截图</ActionBtn>
  </div>
);

interface ResultProps {
  result: ParseResult; block: QuestionBlock | null;
  showDetail: boolean; showFeedback: boolean;
  onToggleDetail: () => void; onToggleFeedback: () => void;
}

const ResultContent: React.FC<ResultProps> = ({
  result, block, showDetail, showFeedback, onToggleDetail, onToggleFeedback,
}) => (
  <div style={{fontSize:13, lineHeight:1.6}}>
    {result.warning && (
      <div style={{
        padding:"6px 10px", borderRadius:6, backgroundColor:"#2c1f00",
        border:"1px solid #7c5c00", color:"#f9e2af", marginBottom:10, fontSize:12,
      }}>⚠️ {result.warning}</div>
    )}

    {/* Answer */}
    <div style={{marginBottom:10}}>
      <Label>答案</Label>
      <div style={{fontSize:28, fontWeight:700, color:"#a6e3a1", letterSpacing:3}}>{result.answer}</div>
    </div>

    {/* Brief */}
    <div style={{marginBottom:8}}>
      <Label>简短解析</Label>
      <div style={{color:"#cdd6f4"}}>{result.briefExplanation}</div>
    </div>

    {/* Detail toggle */}
    <button onClick={onToggleDetail} style={{
      background:"none", border:"none", color:"#89b4fa",
      cursor:"pointer", fontSize:12, padding:"2px 0", marginBottom: showDetail ? 8 : 4,
      fontFamily:"system-ui,sans-serif",
    }}>
      {showDetail ? "▲ 收起详解" : "▼ 展开详解"}
    </button>

    {showDetail && (
      <div style={{
        color:"#cdd6f4", backgroundColor:"#181825",
        padding:"8px 10px", borderRadius:6, fontSize:12,
        lineHeight:1.7, marginBottom:10, whiteSpace:"pre-wrap",
      }}>{result.detailedExplanation}</div>
    )}

    {/* Recognized text */}
    {result.recognizedText && (
      <details style={{marginBottom:8}}>
        <summary style={{fontSize:11, color:"#6c7086", userSelect:"none"}}>识别文字</summary>
        <div style={{
          fontSize:11, color:"#585b70", backgroundColor:"#181825",
          padding:"6px", borderRadius:4, marginTop:4,
          maxHeight:60, overflowY:"auto", whiteSpace:"pre-wrap",
        }}>{result.recognizedText}</div>
      </details>
    )}

    {/* Confidence */}
    <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
      <span style={{color:"#585b70", fontSize:11, flexShrink:0}}>置信度</span>
      <div style={{flex:1, height:4, backgroundColor:"#313244", borderRadius:2, overflow:"hidden"}}>
        <div style={{
          height:"100%",
          width:`${Math.round(result.confidence*100)}%`,
          backgroundColor: result.confidence>0.8 ? "#a6e3a1" : result.confidence>0.5 ? "#f9e2af" : "#f38ba8",
          borderRadius:2, transition:"width 0.4s",
        }}/>
      </div>
      <span style={{color:"#585b70", fontSize:11, flexShrink:0}}>{Math.round(result.confidence*100)}%</span>
    </div>

    {/* Feedback panel */}
    {showFeedback && <FeedbackPanel result={result} block={block} onClose={onToggleFeedback} />}
  </div>
);

const FeedbackPanel: React.FC<{result: ParseResult; block: QuestionBlock|null; onClose: () => void}> = ({result, block, onClose}) => {
  const [sent, setSent] = useState(false);
  const info = [
    `blockId: ${result.blockId}`,
    `host: ${location.hostname}`,
    `route: ${result.routeUsed}`,
    `confidence: ${result.confidence}`,
    `ocrQuality: ${result.ocrQualityScore ?? "N/A"}`,
    `questionType: ${result.questionType}`,
    block?.previewText ? `preview: ${block.previewText.slice(0,60)}` : "",
  ].filter(Boolean).join("\n");

  return (
    <div style={{backgroundColor:"#181825", border:"1px solid #313244", borderRadius:8, padding:"10px 12px", marginTop:8}}>
      <div style={{fontSize:12, fontWeight:600, color:"#f9e2af", marginBottom:6}}>反馈错误</div>
      <textarea defaultValue={`解析有误，正确答案应为：\n\n--- 自动收集信息 ---\n${info}`} style={{
        width:"100%", minHeight:80, backgroundColor:"#1e1e2e",
        border:"1px solid #45475a", borderRadius:4, color:"#cdd6f4",
        fontSize:11, padding:6, resize:"vertical", boxSizing:"border-box",
        fontFamily:"system-ui,sans-serif",
      }}/>
      <div style={{display:"flex", gap:6, marginTop:6}}>
        {!sent
          ? <ActionBtn onClick={() => setSent(true)} primary>提交反馈</ActionBtn>
          : <span style={{fontSize:12, color:"#a6e3a1"}}>✓ 感谢反馈</span>}
        <ActionBtn onClick={onClose}>取消</ActionBtn>
      </div>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────


const Label: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div style={{color:"#a6adc8", fontSize:11, textTransform:"uppercase", letterSpacing:0.5, marginBottom:2}}>
    {children}
  </div>
);

const iconBtnStyle: React.CSSProperties = {
  background:"none", border:"none", color:"#a6adc8",
  cursor:"pointer", fontSize:13, padding:"2px 6px",
  borderRadius:4, lineHeight:1, fontFamily:"system-ui,sans-serif",
};

const ActionBtn: React.FC<{children: React.ReactNode; onClick: () => void; primary?: boolean}> = ({children, onClick, primary}) => (
  <button onClick={onClick} style={{
    padding:"5px 12px", borderRadius:6, border:"none",
    backgroundColor: primary ? "#4f9cf9" : "#313244",
    color: primary ? "#fff" : "#cdd6f4",
    cursor:"pointer", fontSize:12, fontWeight: primary ? 600 : 400,
    fontFamily:"system-ui,sans-serif",
  }}>{children}</button>
);
