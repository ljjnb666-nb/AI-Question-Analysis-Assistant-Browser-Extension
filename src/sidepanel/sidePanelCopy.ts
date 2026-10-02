import type { UILang } from "./displayUtils";

export interface SidePanelCopy {
  appName: string;
  contextLine: (providerName?: string) => string;
  contextProtected: string;
  status: {
    checking_session: string;
    signed_out: string;
    service_unavailable: string;
    ready: string;
    detecting: string;
    scanning: string;
    solving: string;
    review_required: string;
  };
  tabs: {
    candidates: string;
    history: string;
    settings: string;
    ariaLabel: string;
  };
  menu: {
    buttonAria: string;
    switchLang: string;
    settings: string;
    signOut: string;
    accountHeader: string;
  };
  locked: {
    checkingTitle: string;
    checkingDesc: string;
    unavailableTitle: string;
    unavailableDesc: string;
    signedOutTitle: string;
    signedOutDesc: string;
    retry: string;
    openSettings: string;
    signInOrSettings: string;
  };
  activity: {
    detecting: string;
    scanning: string;
    scanningProgress: (step: number, total: number, found: number) => string;
    solving: string;
    solvingProgress: (current: number, total: number, filled: number) => string;
    reviewFallback: string;
    stop: string;
    dismiss: string;
    check: string;
  };
}

export const SIDEPANEL_COPY: Record<UILang, SidePanelCopy> = {
  zh: {
    appName: "题目解析助手",
    contextLine: (providerName) => `当前页面 · ${providerName || "Claude"}`,
    contextProtected: "受保护工作台",
    status: {
      checking_session: "正在验证",
      signed_out: "未登录",
      service_unavailable: "服务不可用",
      ready: "已就绪",
      detecting: "识别中",
      scanning: "扫描中",
      solving: "解析中",
      review_required: "需要检查",
    },
    tabs: {
      candidates: "候选题",
      history: "历史",
      settings: "设置",
      ariaLabel: "工作台主导航",
    },
    menu: {
      buttonAria: "工作台菜单",
      switchLang: "Switch to English",
      settings: "前往设置",
      signOut: "退出登录",
      accountHeader: "已登录账号",
    },
    locked: {
      checkingTitle: "正在验证登录状态",
      checkingDesc: "受保护功能暂时保持锁定",
      unavailableTitle: "暂时无法验证登录状态",
      unavailableDesc: "工作台保持锁定",
      signedOutTitle: "登录后使用工作台",
      signedOutDesc: "请先登录账号以使用候选题、批量解析与填答等功能。",
      retry: "重试",
      openSettings: "前往设置",
      signInOrSettings: "登录 / 前往设置",
    },
    activity: {
      detecting: "正在识别当前页面",
      scanning: "整页扫描",
      scanningProgress: (step, total, found) => `第 ${step} / ${total} 步 · 已发现 ${found} 题`,
      solving: "解析并填答",
      solvingProgress: (current, total, filled) => `第 ${current} / ${total} 题 · 已填写 ${filled} 题`,
      reviewFallback: "页面变化导致操作安全停止",
      stop: "停止",
      dismiss: "我知道了",
      check: "检查",
    },
  },
  en: {
    appName: "Quiz Solver",
    contextLine: (providerName) => `Current Page · ${providerName || "Claude"}`,
    contextProtected: "Protected Workspace",
    status: {
      checking_session: "Checking",
      signed_out: "Signed Out",
      service_unavailable: "Unavailable",
      ready: "Ready",
      detecting: "Detecting",
      scanning: "Scanning",
      solving: "Solving",
      review_required: "Check Needed",
    },
    tabs: {
      candidates: "Candidates",
      history: "History",
      settings: "Settings",
      ariaLabel: "Workspace Navigation",
    },
    menu: {
      buttonAria: "Workspace menu",
      switchLang: "切换到简体中文",
      settings: "Settings",
      signOut: "Sign Out",
      accountHeader: "Signed in as",
    },
    locked: {
      checkingTitle: "Verifying Session...",
      checkingDesc: "Protected features remain locked while checking session.",
      unavailableTitle: "Can't verify sign-in right now",
      unavailableDesc: "The workspace stays locked because the account service cannot be reached.",
      signedOutTitle: "Sign In to Use Workspace",
      signedOutDesc: "Please sign in to access candidates, batch solving, and fill features.",
      retry: "Retry",
      openSettings: "Open Settings",
      signInOrSettings: "Sign In / Open Settings",
    },
    activity: {
      detecting: "Detecting current page...",
      scanning: "Full Page Scan",
      scanningProgress: (step, total, found) => `Step ${step} / ${total} · Found ${found} questions`,
      solving: "Solve & Fill",
      solvingProgress: (current, total, filled) => `Question ${current} / ${total} · Filled ${filled}`,
      reviewFallback: "Page change caused a safety stop",
      stop: "Stop",
      dismiss: "Dismiss",
      check: "Review",
    },
  },
};
