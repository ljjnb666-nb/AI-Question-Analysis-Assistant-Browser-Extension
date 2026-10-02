export type PopupLang = "zh" | "en";

export const POPUP_COPY = {
  zh: {
    appName: "题目解析助手",
    trustCopy: "提交仍由你确认",
    noAutoSubmitNotice: "不会自动提交",
    connected: (providerName: string) => `已连接 ${providerName}`,
    demoMode: "未配置 AI 服务",
    loading: "正在检查...",
    provider: "服务商",
    version: "版本",
    panel: "工作台",
    ready: "已就绪",
    checking: "正在检查",
    signedOut: "未登录",
    serviceUnavailable: "服务不可用",
    pageUnavailable: "页面不可用",
    running: "处理中",
    reviewRequired: "需要检查",
    providerSetupRequired: "待配置 AI",
    
    // Page context
    pageInjectable: "当前页面可识别",
    pageNotInjectable: "受限页面不可操作",

    // Primary action
    solveTitle: "解析并填答",
    solveSubtitle: "识别题目、生成答案并填写；不会自动提交",
    solveDisabledNoProvider: "请先配置 AI 服务",
    
    // Secondary commands
    actions: "快捷操作",
    actionsDesc: "常用入口，即点即用",
    manualTitle: "手动截图",
    manualSubtitle: "框选题目标记",
    detectTitle: "当前屏识别",
    detectSubtitle: "扫描当前屏题目",
    fullPageTitle: "整页扫描",
    fullPageSubtitle: "扫描全部题块",

    // Workspace & navigation
    workspaceTitle: "工作台",
    workspaceDesc: "打开候选题、答题历史和设置。",
    openPanel: "打开完整工作台",
    shortcuts: "快捷键",
    shortcutKey: "Alt+Q",

    // Action feedback
    startManual: "正在启动手动截图...",
    manualError: "当前页面无法注入，请刷新页面后重试。",
    startDetect: "正在识别当前页题目...",
    detectError: "当前页面无法识别，请刷新页面后重试。",
    startFullPage: "正在扫描整页题目...",
    fullPageError: "整页扫描启动失败，请刷新页面后重试。",
    startSolve: "正在解析并填答...",
    solveError: "解析并填答启动失败，请刷新页面后重试。",
    providerMissingWarning: "请先在工作台设置中配置 AI 服务，再启动解析并填答。",
    authRequiredWarning: "请先通过登录验证后再使用该功能。",
    sessionExpiredNotice: "登录验证已失效，该操作未开始。",
    safetyCheckWarning: "检测到题目或页面变动，操作已安全中止。",

    // Auth view
    login: "登录",
    register: "注册",
    loginHint: "使用已注册账号进入插件",
    registerHint: "验证真实邮箱并完成注册",
    emailLabel: "邮箱",
    emailPlaceholder: "邮箱",
    passwordLabel: "密码",
    passwordPlaceholder: "密码",
    verificationCodeLabel: "验证码",
    sendCode: "发送验证码",
    sendingCode: "发送中...",
    completeRegistration: "完成注册并登录",
    registering: "正在注册...",
    loggingIn: "正在登录...",
    showPassword: "显示",
    hidePassword: "隐藏",
    sessionExpired: "登录状态已失效，请重新登录。",
    validatingSession: "正在验证登录状态...",
    sessionUnavailable: "暂时无法验证登录状态",
    sessionUnavailableHint: "认证服务连接失败，受保护功能保持锁定。",
    retrySession: "重试",
    logout: "退出登录",
    goToLogin: "已有账号？去登录",
    goToRegister: "还没有账号？去注册",

    // Menu
    menuSettings: "工作台设置",
    menuSwitchLang: "Switch to English",
    menuLogout: "退出登录",
    menuHelp: "帮助与反馈",
  },
  en: {
    appName: "Quiz Solver",
    trustCopy: "Submission stays manual",
    noAutoSubmitNotice: "No automatic submission",
    connected: (providerName: string) => `Connected ${providerName}`,
    demoMode: "AI Not Configured",
    loading: "Checking...",
    provider: "Provider",
    version: "Version",
    panel: "Workspace",
    ready: "Ready",
    checking: "Checking",
    signedOut: "Signed Out",
    serviceUnavailable: "Unavailable",
    pageUnavailable: "Unsupported",
    running: "Processing",
    reviewRequired: "Check Needed",
    providerSetupRequired: "Setup Needed",

    // Page context
    pageInjectable: "Current page supported",
    pageNotInjectable: "Restricted page unavailable",

    // Primary action
    solveTitle: "Solve & Fill",
    solveSubtitle: "Detect, solve, and fill answers. Submission stays manual.",
    solveDisabledNoProvider: "Configure an AI provider first",

    // Secondary commands
    actions: "Quick Actions",
    actionsDesc: "Common shortcuts to start quickly",
    manualTitle: "Manual Capture",
    manualSubtitle: "Select Area",
    detectTitle: "Detect Current View",
    detectSubtitle: "Scan visible questions",
    fullPageTitle: "Scan Full Page",
    fullPageSubtitle: "Scan all blocks",

    // Workspace & navigation
    workspaceTitle: "Workspace",
    workspaceDesc: "Open candidates, history, and settings.",
    openPanel: "Open Workspace",
    shortcuts: "Shortcut",
    shortcutKey: "Alt+Q",

    // Action feedback
    startManual: "Starting manual capture...",
    manualError: "Cannot inject into this page. Refresh the page and try again.",
    startDetect: "Detecting questions in current view...",
    detectError: "Cannot detect on this page. Refresh the page and try again.",
    startFullPage: "Scanning full page questions...",
    fullPageError: "Cannot start full page scan. Refresh the page and try again.",
    startSolve: "Starting Solve & Fill...",
    solveError: "Cannot start Solve & Fill. Refresh the page and try again.",
    providerMissingWarning: "Configure an AI provider in Workspace Settings before starting Solve & Fill.",
    authRequiredWarning: "Sign in with a verified session before using this action.",
    sessionExpiredNotice: "Sign-in verification ended. The action was not started.",
    safetyCheckWarning: "Page or question change detected. Safely stopped.",

    // Auth view
    login: "Login",
    register: "Register",
    loginHint: "Sign in to access protected features",
    registerHint: "Verify your email and create an account",
    emailLabel: "Email",
    emailPlaceholder: "Email",
    passwordLabel: "Password",
    passwordPlaceholder: "Password",
    verificationCodeLabel: "Verification Code",
    sendCode: "Send Code",
    sendingCode: "Sending...",
    completeRegistration: "Complete Registration",
    registering: "Registering...",
    loggingIn: "Signing in...",
    showPassword: "Show",
    hidePassword: "Hide",
    sessionExpired: "Session expired. Please sign in again.",
    validatingSession: "Verifying session...",
    sessionUnavailable: "Authentication Temporarily Unavailable",
    sessionUnavailableHint: "Could not reach auth server. Protected features remain locked.",
    retrySession: "Retry",
    logout: "Sign Out",
    goToLogin: "Already have an account? Sign in",
    goToRegister: "Don't have an account? Register",

    // Menu
    menuSettings: "Workspace Settings",
    menuSwitchLang: "切换为中文",
    menuLogout: "Sign Out",
    menuHelp: "Help & Feedback",
  },
} as const;

export type PopupCopy = {
  [K in keyof typeof POPUP_COPY.zh]: (typeof POPUP_COPY.zh)[K] extends (...args: infer P) => infer R
    ? (...args: P) => R
    : string;
};
