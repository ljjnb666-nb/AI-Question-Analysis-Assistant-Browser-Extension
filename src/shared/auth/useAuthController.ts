import { useEffect, useMemo, useState } from "react";
import { loadSettings } from "@/shared/utils/storage";
import {
  loginWithEmail,
  logoutAccount,
  registerWithEmailCode,
  sendEmailVerificationCode,
} from "@/shared/utils/auth";
import { getAuthText, type AuthCopyVariant, type AuthLang } from "./authText";

type AuthView = "register" | "login";
type AuthBusy = "send-code" | "register" | "login" | "logout" | null;

type IdentityState = {
  userId: string;
  userEmail: string;
};

type UseAuthControllerOptions = {
  lang: AuthLang;
  variant: AuthCopyVariant;
  beforeAction?: () => Promise<void> | void;
};

export function useAuthController(options: UseAuthControllerOptions) {
  const copy = useMemo(
    () => getAuthText(options.lang, options.variant),
    [options.lang, options.variant],
  );
  const [view, setView] = useState<AuthView>("register");
  const [authBusy, setAuthBusy] = useState<AuthBusy>(null);
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const [identity, setIdentity] = useState<IdentityState>({ userId: "", userEmail: "" });

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setCodeCooldown((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  const isAuthenticated = Boolean(identity.userId && identity.userEmail);

  const refreshIdentity = async () => {
    const settings = await loadSettings();
    const nextIdentity = {
      userId: settings.userId ?? "",
      userEmail: settings.userEmail ?? "",
    };
    setIdentity(nextIdentity);
    return nextIdentity;
  };

  const runBeforeAction = async () => {
    await options.beforeAction?.();
  };

  const switchView = (nextView: AuthView) => {
    setView(nextView);
    setFeedback("");
    if (nextView === "login") {
      setCodeSent(false);
      setVerificationCode("");
    }
  };

  const handleRegister = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password.trim() || !verificationCode.trim()) {
      setFeedback(copy.requiredRegistrationFields);
      return;
    }

    try {
      await runBeforeAction();
      setAuthBusy("register");
      setFeedback("");
      await registerWithEmailCode(normalizedEmail, password, verificationCode.trim());
      await refreshIdentity();
      setPassword("");
      setVerificationCode("");
      setFeedback(copy.registerSuccess);
    } catch (error) {
      setFeedback(copy.authFailed(String(error)));
    } finally {
      setAuthBusy(null);
    }
  };

  const handleLogin = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password.trim()) {
      setFeedback(copy.requiredLoginFields);
      return;
    }

    try {
      await runBeforeAction();
      setAuthBusy("login");
      setFeedback("");
      await loginWithEmail(normalizedEmail, password);
      await refreshIdentity();
      setPassword("");
      setFeedback(copy.loginSuccess);
    } catch (error) {
      setFeedback(copy.authFailed(String(error)));
    } finally {
      setAuthBusy(null);
    }
  };

  const handleSendCode = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setFeedback(copy.requiredEmail);
      return;
    }

    try {
      await runBeforeAction();
      setAuthBusy("send-code");
      setFeedback("");
      await sendEmailVerificationCode(normalizedEmail);
      setCodeCooldown(60);
      setCodeSent(true);
      setFeedback(copy.codeSent);
    } catch (error) {
      setFeedback(copy.sendFailed(String(error)));
    } finally {
      setAuthBusy(null);
    }
  };

  const handleLogout = async () => {
    try {
      await runBeforeAction();
      setAuthBusy("logout");
      await logoutAccount();
      await refreshIdentity();
      setView("login");
      setEmail("");
      setPassword("");
      setVerificationCode("");
      setCodeSent(false);
      setFeedback(copy.loggedOut);
    } finally {
      setAuthBusy(null);
    }
  };

  return {
    authBusy,
    codeCooldown,
    codeSent,
    email,
    feedback,
    handleLogin,
    handleLogout,
    handleRegister,
    handleSendCode,
    isAuthenticated,
    password,
    refreshIdentity,
    setEmail,
    setFeedback,
    setIdentity,
    setPassword,
    setVerificationCode,
    showPassword,
    switchView,
    userEmail: identity.userEmail,
    userId: identity.userId,
    verificationCode,
    view,
    togglePasswordVisibility: () => setShowPassword((previous) => !previous),
  };
}
