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
  authFailed: (message: string) => string;
  sendFailed: (message: string) => string;
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
      authFailed: (message) => `Auth failed: ${message}`,
      sendFailed: (message) => `Send failed: ${message}`,
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
    authFailed: (message) => `认证失败：${message}`,
    sendFailed: (message) => `发送失败：${message}`,
  };
}

