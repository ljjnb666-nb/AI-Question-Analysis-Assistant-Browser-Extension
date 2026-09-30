import { useEffect, useMemo, useState } from "react";
import {
  loginWithEmail,
  logoutAccount,
  registerWithEmailCode,
  sendEmailVerificationCode,
} from "@/shared/utils/auth";
import { classifyAuthError } from "./authErrorContract";
import { useAuthSession } from "./useAuthSession";
import { getAuthText, type AuthCopyVariant, type AuthLang } from "./authText";

type AuthView = "register" | "login";
type AuthBusy = "send-code" | "register" | "login" | "logout" | null;

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
  const session = useAuthSession();
  const sessionState = session.getState();
  const [view, setView] = useState<AuthView>("register");
  const [authBusy, setAuthBusy] = useState<AuthBusy>(null);
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setCodeCooldown((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  // The only authority for protected UI is the server-validated session
  // status. Local storage values never unlock anything by themselves.
  const status = sessionState.status;
  const isAuthenticated = status === "authenticated";
  const isSessionPending = status === "loading" || status === "validating";
  const isServerUnavailable = status === "server_unavailable";

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
      const result = await registerWithEmailCode(normalizedEmail, password, verificationCode.trim());
      if (!result?.user?.userId) {
        // Malformed success response: fail closed instead of trusting the
        // credentials that may have been persisted.
        session.applyLoggedOut();
        setFeedback(copy.authFailureMessage("generic"));
      } else {
        await session.applyAuthenticatedSession(result.user.userId, result.user.email);
        setPassword("");
        setVerificationCode("");
        setFeedback(copy.registerSuccess);
      }
    } catch (error) {
      setFeedback(copy.authFailureMessage(classifyAuthError(error)));
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
      const result = await loginWithEmail(normalizedEmail, password);
      if (!result?.user?.userId) {
        session.applyLoggedOut();
        setFeedback(copy.authFailureMessage("generic"));
      } else {
        await session.applyAuthenticatedSession(result.user.userId, result.user.email);
        setPassword("");
        setFeedback(copy.loginSuccess);
      }
    } catch (error) {
      setFeedback(copy.authFailureMessage(classifyAuthError(error)));
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
      setFeedback(copy.sendCodeFailureMessage(classifyAuthError(error)));
    } finally {
      setAuthBusy(null);
    }
  };

  const handleLogout = async () => {
    try {
      await runBeforeAction();
      setAuthBusy("logout");
      // AUTH-UI-INV-14: local logout is IMMEDIATE. The coordinator (and via
      // the storage clear inside logoutAccount, every other surface) drops
      // to unauthenticated right away; the server revoke is a best-effort
      // follow-up whose outcome only shapes the final hint.
      session.applyLoggedOut();
      setView("login");
      setEmail("");
      setPassword("");
      setVerificationCode("");
      setCodeSent(false);
      let serverUncertain = true;
      try {
        const result = await logoutAccount();
        serverUncertain = !result.serverRevoked && result.serverStatus !== "no_local_credentials";
      } catch {
        serverUncertain = true;
      }
      setFeedback(serverUncertain ? copy.loggedOutServerUncertain : copy.loggedOut);
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
    isSessionPending,
    isServerUnavailable,
    password,
    retryValidation: () => session.retryValidation(),
    session,
    sessionRejected: sessionState.sessionRejected,
    setEmail,
    setFeedback,
    setPassword,
    setVerificationCode,
    showPassword,
    status,
    switchView,
    userEmail: sessionState.userEmail,
    userId: sessionState.userId,
    verificationCode,
    view,
    togglePasswordVisibility: () => setShowPassword((previous) => !previous),
  };
}

export type AuthControllerValue = ReturnType<typeof useAuthController>;
