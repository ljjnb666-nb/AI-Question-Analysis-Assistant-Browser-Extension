import type { AuthFeedbackKind } from "./authErrorContract";

export type AuthLang = "zh" | "en";
export type AuthCopyVariant = "popup" | "settings";

type AuthText = {
  registerTab: string;
  loginTab: string;
  registerPage: string;
  loginPage: string;
  emailPlaceholder: string;
  passwordPlaceholder: string;
  verificationCodePlaceholder: string;
  sendCode: string;
  sendingCode: string;
  completeRegistration: string;
  registering: string;
  login: string;
  loggingIn: string;
  logout: string;
  loggingOut: string;
  showPassword: string;
  hidePassword: string;
  requiredRegistrationFields: string;
  requiredLoginFields: string;
  requiredEmail: string;
  registerSuccess: string;
  loginSuccess: string;
  codeSent: string;
  loggedOut: string;
  /** Startup/state copy for the shared server-validated session model. */
  validatingSession: string;
  sessionUnavailable: string;
  sessionUnavailableHint: string;
  retrySession: string;
  sessionExpired: string;
  loggedOutServerUncertain: string;
  authFailed: (message: string) => string;
  sendFailed: (message: string) => string;
  /** Maps classified auth errors to safe, localized feedback. */
  authFailureMessage: (kind: AuthFeedbackKind) => string;
  sendCodeFailureMessage: (kind: AuthFeedbackKind) => string;
};

export function getAuthText(lang: AuthLang, variant: AuthCopyVariant): AuthText {
  if (lang === "en") {
    return {
      registerTab: "Register",
      loginTab: "Login",
      registerPage: "Register Page",
      loginPage: "Login Page",
      emailPlaceholder: "Email",
      passwordPlaceholder: "Password",
      verificationCodePlaceholder: "Verification Code",
      sendCode: "Send Code",
      sendingCode: "Sending...",
      completeRegistration: "Complete Registration",
      registering: "Registering...",
      login: "Login",
      loggingIn: "Logging in...",
      logout: variant === "popup" ? "Reset" : "Logout",
      loggingOut: "Logging out...",
      showPassword: "Show",
      hidePassword: "Hide",
      requiredRegistrationFields: "Email, password, and verification code are required.",
      requiredLoginFields: "Email and password are required.",
      requiredEmail: "Email is required.",
      registerSuccess:
        variant === "popup" ? "Registration complete. Plugin unlocked." : "Registration succeeded.",
      loginSuccess: variant === "popup" ? "Login complete. Plugin unlocked." : "Login succeeded.",
      codeSent:
        variant === "popup"
          ? "Verification code sent. Check your inbox."
          : "Verification code sent.",
      loggedOut: "Logged out.",
      validatingSession: "Verifying your session...",
      sessionUnavailable: "Can't verify sign-in right now",
      sessionUnavailableHint:
        "The account service can't be reached, so protected features stay locked.",
      retrySession: "Retry",
      sessionExpired: "Your session has expired. Please sign in again.",
      loggedOutServerUncertain:
        "Signed out on this device, but the server session revoke couldn't be confirmed.",
      authFailed: (message) => `Auth failed: ${message}`,
      sendFailed: (message) => `Send failed: ${message}`,
      authFailureMessage: (kind) => {
        switch (kind) {
          case "invalid_credentials":
            return "Email or password is incorrect.";
          case "email_already_registered":
            return "This email is already registered. Try signing in.";
          case "invalid_verification_code":
            return "The verification code is invalid or has expired.";
          case "rate_limited":
            return "Too many attempts. Please wait a moment and try again.";
          case "timeout":
            return "The request timed out. Please try again later.";
          case "network":
            return "Network error. Check your connection and try again.";
          default:
            return "Authentication failed. Please try again later.";
        }
      },
      sendCodeFailureMessage: (kind) => {
        switch (kind) {
          case "rate_limited":
            return "Too many verification codes requested. Please wait before retrying.";
          case "email_service_unavailable":
            return "The email service is temporarily unavailable. Please try again later.";
          case "timeout":
            return "The request timed out. Please try again later.";
          case "network":
            return "Network error. Check your connection and try again.";
          default:
            return "Failed to send the verification code. Please try again later.";
        }
      },
    };
  }

  return {
    registerTab: "注册",
    loginTab: "登录",
    registerPage: "注册页",
    loginPage: "登录页",
    emailPlaceholder: "邮箱",
    passwordPlaceholder: "密码",
    verificationCodePlaceholder: "邮箱验证码",
    sendCode: "发送验证码",
    sendingCode: "发送中...",
    completeRegistration: "完成注册",
    registering: "注册中...",
    login: "登录",
    loggingIn: "登录中...",
    logout: variant === "popup" ? "重置" : "退出登录",
    loggingOut: "退出中...",
    showPassword: "显示",
    hidePassword: "隐藏",
    requiredRegistrationFields: "邮箱、密码和验证码不能为空。",
    requiredLoginFields: "邮箱和密码不能为空。",
    requiredEmail: "邮箱不能为空。",
    registerSuccess: variant === "popup" ? "注册成功，插件已解锁。" : "注册成功。",
    loginSuccess: variant === "popup" ? "登录成功，插件已解锁。" : "登录成功。",
    codeSent: variant === "popup" ? "验证码已发送，请检查邮箱。" : "验证码已发送。",
    loggedOut: "已退出登录。",
    validatingSession: "正在验证登录状态...",
    sessionUnavailable: "暂时无法验证登录状态",
    sessionUnavailableHint: "账号服务暂时不可达，受保护的功能保持锁定。",
    retrySession: "重试",
    sessionExpired: "登录已失效，请重新登录。",
    loggedOutServerUncertain: "已退出本机登录，但服务器会话吊销未确认。",
    authFailed: (message) => `认证失败：${message}`,
    sendFailed: (message) => `发送失败：${message}`,
    authFailureMessage: (kind) => {
      switch (kind) {
        case "invalid_credentials":
          return "邮箱或密码不正确。";
        case "email_already_registered":
          return "该邮箱已注册，请直接登录。";
        case "invalid_verification_code":
          return "验证码不正确或已过期。";
        case "rate_limited":
          return "尝试次数过多，请稍后再试。";
        case "timeout":
          return "请求超时，请稍后重试。";
        case "network":
          return "网络异常，请检查网络后重试。";
        default:
          return "认证失败，请稍后重试。";
      }
    },
    sendCodeFailureMessage: (kind) => {
      switch (kind) {
        case "rate_limited":
          return "验证码发送过于频繁，请稍后再试。";
        case "email_service_unavailable":
          return "邮件服务暂时不可用，请稍后重试。";
        case "timeout":
          return "请求超时，请稍后重试。";
        case "network":
          return "网络异常，请检查网络后重试。";
        default:
          return "验证码发送失败，请稍后重试。";
      }
    },
  };
}
