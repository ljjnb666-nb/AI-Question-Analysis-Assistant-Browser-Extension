import { useEffect, useMemo, useRef, useState } from "react";
import {
  loginWithEmail,
  logoutAccount,
  registerWithEmailCode,
  sendEmailVerificationCode,
} from "@/shared/utils/auth";
import { classifyAuthError } from "./authErrorContract";
import { loadSettings } from "@/shared/utils/storage";
import {
  clearPopupRegistrationDraft,
  loadPopupRegistrationDraft,
  savePopupRegistrationDraft,
} from "./popupRegistrationDraft";
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
  const [email, setEmailState] = useState("");
  const emailRef = useRef("");
  const editVersionRef = useRef(0);
  const sentForEmailRef = useRef("");
  const codeExpiresAtRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const codeBackendRef = useRef("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);

  const isPopup = options.variant === "popup";

  const snapshotDraft = () => ({
    email: emailRef.current,
    ...(sentForEmailRef.current && codeExpiresAtRef.current > Date.now()
      ? {
          sentForEmail: sentForEmailRef.current,
          codeExpiresAt: codeExpiresAtRef.current,
          cooldownUntil: cooldownUntilRef.current,
          backendUrl: codeBackendRef.current,
        }
      : {}),
  });

  const forgetSentCode = () => {
    sentForEmailRef.current = "";
    codeExpiresAtRef.current = 0;
    cooldownUntilRef.current = 0;
    codeBackendRef.current = "";
    setCodeCooldown(0);
    setCodeSent(false);
    setVerificationCode("");
  };

  const setEmail = (value: string) => {
    editVersionRef.current += 1;
    if (value.trim().toLowerCase() !== emailRef.current.trim().toLowerCase()) forgetSentCode();
    emailRef.current = value;
    setEmailState(value);
    if (isPopup) void savePopupRegistrationDraft(snapshotDraft());
  };

  // MV3 action popups are torn down when focus leaves for the email inbox.
  // Restore only non-secret registration metadata from volatile session
  // storage. A slow read must never overwrite subsequent typing.
  useEffect(() => {
    if (!isPopup) return;
    let alive = true;
    const readVersion = editVersionRef.current;
    void (async () => {
      const draft = await loadPopupRegistrationDraft();
      if (!draft) return;
      const settings = await loadSettings().catch(() => null);
      if (!alive || readVersion !== editVersionRef.current || session.getState().status === "authenticated") return;
      emailRef.current = draft.email;
      setEmailState(draft.email);
      if (
        settings &&
        draft.sentForEmail?.toLowerCase() === draft.email.toLowerCase() &&
        draft.backendUrl === settings.analyticsBaseUrl &&
        draft.codeExpiresAt && draft.codeExpiresAt > Date.now()
      ) {
        sentForEmailRef.current = draft.sentForEmail;
        codeExpiresAtRef.current = draft.codeExpiresAt;
        cooldownUntilRef.current = draft.cooldownUntil ?? 0;
        codeBackendRef.current = draft.backendUrl;
        setCodeSent(true);
        setCodeCooldown(Math.max(0, Math.ceil((cooldownUntilRef.current - Date.now()) / 1000)));
      }
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [isPopup, session]);

  useEffect(() => {
    if (!isPopup && codeCooldown <= 0) return;
    if (isPopup && codeCooldown <= 0 && !codeSent) return;
    const timer = window.setTimeout(() => {
      if (!isPopup) {
        setCodeCooldown((previous) => Math.max(0, previous - 1));
        return;
      }
      setCodeCooldown(Math.max(0, Math.ceil((cooldownUntilRef.current - Date.now()) / 1000)));
      if (codeExpiresAtRef.current > 0 && Date.now() >= codeExpiresAtRef.current) {
        forgetSentCode();
        void savePopupRegistrationDraft(snapshotDraft());
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown, codeSent, isPopup]);

  // A real server-validated login removes an abandoned registration draft;
  // a local cached email can never confer authentication authority.
  useEffect(() => {
    if (isPopup && sessionState.status === "authenticated") void clearPopupRegistrationDraft();
  }, [isPopup, sessionState.status]);

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
      forgetSentCode();
      if (isPopup) void savePopupRegistrationDraft(snapshotDraft());
    }
  };

  const handleRegister = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password.trim() || !verificationCode.trim()) {
      setFeedback(copy.requiredRegistrationFields);
      return;
    }
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)) {
      setFeedback(copy.authFailureMessage("email_invalid"));
      return;
    }
    if (password.length < 6) {
      setFeedback(copy.authFailureMessage("password_too_short"));
      return;
    }
    if (!/^\\d{6}$/.test(verificationCode.trim())) {
      setFeedback(copy.authFailureMessage("invalid_verification_code"));
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
        forgetSentCode();
        if (isPopup) await clearPopupRegistrationDraft();
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
        if (isPopup) await clearPopupRegistrationDraft();
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
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)) {
      setFeedback(copy.authFailureMessage("email_invalid"));
      return;
    }

    try {
      await runBeforeAction();
      const requestedBackend = isPopup ? (await loadSettings()).analyticsBaseUrl : "";
      setAuthBusy("send-code");
      setFeedback("");
      const result = await sendEmailVerificationCode(normalizedEmail);
      // If the user edited the email during an in-flight request, never
      // present a code field for a different recipient.
      if (emailRef.current.trim().toLowerCase() !== normalizedEmail.toLowerCase()) return;
      if (isPopup) {
        const latestBackend = (await loadSettings()).analyticsBaseUrl;
        if (latestBackend !== requestedBackend) return;
        sentForEmailRef.current = normalizedEmail;
        codeExpiresAtRef.current = result.expiresAt;
        cooldownUntilRef.current = Date.now() + 60_000;
        codeBackendRef.current = requestedBackend;
        // Complete the session write BEFORE showing a successful send. A user
        // can now switch tabs immediately after seeing the confirmation.
        const saved = await savePopupRegistrationDraft(snapshotDraft());
        setCodeCooldown(Math.max(0, Math.ceil((cooldownUntilRef.current - Date.now()) / 1000)));
        setCodeSent(true);
        setFeedback(saved ? copy.codeSent : `${copy.codeSent} ${options.lang === "zh" ? "暂无法保存进度，请不要关闭此窗口。" : "Progress could not be saved; keep this window open."}`);
      } else {
        setCodeCooldown(60);
        setCodeSent(true);
        setFeedback(copy.codeSent);
      }
    } catch (error) {
      setFeedback(copy.sendCodeFailureMessage(classifyAuthError(error)));
    } finally {
      setAuthBusy(null);
    }
  };

  const handleLogout = async () => {
    try {
      setAuthBusy("logout");
      // AUTH-UI-INV-14: local logout is IMMEDIATE and must not wait for any
      // async preparation — beforeAction (settings persistence), network, or
      // anything else. The coordinator (and via the storage clear inside
      // logoutAccount, every other surface) drops to unauthenticated right
      // away; the server revoke is a best-effort follow-up whose outcome
      // only shapes the final hint. beforeAuthRequest-style persistence
      // stays wired to login/register/send-code only.
      session.applyLoggedOut();
      setView("login");
      editVersionRef.current += 1;
      emailRef.current = "";
      setEmailState("");
      setPassword("");
      forgetSentCode();
      if (isPopup) void clearPopupRegistrationDraft();
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
