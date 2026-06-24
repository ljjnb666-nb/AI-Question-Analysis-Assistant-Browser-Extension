import type { FloatingWindowManager } from "./floating/FloatingWindowManager";
import type { AnalyticsEvent } from "@/shared/utils/analytics";

type ContentBindingDeps = {
  floatingMgr: FloatingWindowManager;
  handleAutoDetect: () => void;
  installFormulaEmbedFallback: () => void;
  logEvent: (event: AnalyticsEvent, props?: Record<string, unknown>) => void;
  scheduleHighlightRelayoutRescan: () => void;
  startManualCapture: (forceVisionMode: boolean) => void;
};

export function initializeContentBindings(deps: ContentBindingDeps): void {
  deps.floatingMgr.init();
  deps.floatingMgr.setOnRetake(() => deps.startManualCapture(false));
  deps.floatingMgr.setOnUpgradeVision(() => {
    deps.logEvent("vision_upgrade_triggered");
    deps.startManualCapture(true);
  });
  deps.installFormulaEmbedFallback();

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!e.altKey) return;
    if (e.key === "q" || e.key === "Q") {
      e.preventDefault();
      deps.logEvent("keyboard_shortcut_used", { key: "Alt+Q" });
      deps.startManualCapture(false);
    }
    if (e.key === "w" || e.key === "W") {
      e.preventDefault();
      deps.logEvent("keyboard_shortcut_used", { key: "Alt+W" });
      deps.handleAutoDetect();
    }
  });

  window.addEventListener("resize", deps.scheduleHighlightRelayoutRescan, { passive: true });
  document.addEventListener("scroll", deps.scheduleHighlightRelayoutRescan, { passive: true, capture: true });
  window.visualViewport?.addEventListener("resize", deps.scheduleHighlightRelayoutRescan, { passive: true });
  window.visualViewport?.addEventListener("scroll", deps.scheduleHighlightRelayoutRescan, { passive: true });
}
