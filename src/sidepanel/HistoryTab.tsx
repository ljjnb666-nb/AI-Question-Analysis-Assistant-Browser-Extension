import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { HistoryEntry } from "@/shared/types";
import { clearHistory, exportHistory, loadHistory } from "@/shared/utils/storage";
import type { UILang } from "./displayUtils";
import { HistoryEmptyState, HistoryRecordCard, HistoryToolbarCard } from "./historyTabSections";

type HistoryItem = HistoryEntry;

gsap.registerPlugin(useGSAP);

export const HistoryTab: React.FC<{ lang: UILang }> = ({ lang }) => {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const reload = async () => {
      setHistory(await loadHistory());
    };

    void reload();

    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === "local" && changes.parseHistory) {
        void reload();
      }
    };

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
    setExpandedIds({});
  };

  const handleExport = async () => {
    const json = await exportHistory();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useGSAP(() => {
    gsap.from(".history-head", {
      y: 14,
      autoAlpha: 0,
      duration: 0.45,
      ease: "power2.out",
    });
    gsap.from(".history-card", {
      y: 16,
      autoAlpha: 0,
      duration: 0.4,
      stagger: 0.06,
      ease: "power2.out",
      delay: 0.08,
    });

    const hoverTargets = gsap.utils.toArray<HTMLElement>(".history-head, .history-card");
    const cleanups = hoverTargets.map((element) => {
      const onEnter = () => {
        gsap.to(element, {
          y: -3,
          boxShadow: "0 12px 28px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
          duration: 0.2,
          ease: "power2.out",
        });
      };
      const onLeave = () => {
        gsap.to(element, {
          y: 0,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
          duration: 0.2,
          ease: "power2.out",
        });
      };
      element.addEventListener("mouseenter", onEnter);
      element.addEventListener("mouseleave", onLeave);
      return () => {
        element.removeEventListener("mouseenter", onEnter);
        element.removeEventListener("mouseleave", onLeave);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, { scope: scopeRef, dependencies: [history.length], revertOnUpdate: true });

  if (!history.length) {
    return (
      <div ref={scopeRef}>
        <HistoryEmptyState lang={lang} />
      </div>
    );
  }

  return (
    <div ref={scopeRef} style={{ padding: "12px 0 18px" }}>
      <HistoryToolbarCard lang={lang} onClear={() => void handleClear()} onExport={() => void handleExport()} />

      {history.map((entry) => (
        <HistoryRecordCard
          key={entry.id}
          entry={entry}
          lang={lang}
          onToggleDetails={(id) => setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))}
          showDetails={!!expandedIds[entry.id]}
        />
      ))}
    </div>
  );
};
