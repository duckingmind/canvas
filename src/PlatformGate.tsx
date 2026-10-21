import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { createAppClient } from "@ducking-mind/proxy-app-sdk";
import { agent } from "@ducking-mind/proxy-app-sdk";
import {
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { platformFailure } from "./platform-status";
import { diagnosticErrorFields, migratePreAuthCanvasDiagnostics, recordCanvasDiagnostic } from "./client-diagnostics.ts";
import { resetDocumentStorage, resumeDocumentStorage } from "./document-storage";
import StartupScreen from "./StartupScreen";
import { prepareLocalStorageScope, setLocalStorageScope } from "./local-storage-scope.ts";
import "./platform-gate.css";

type PlatformAccess = {
  ready: boolean;
  revision: number;
  requireLogin: (message?: string) => void;
};

const PlatformAccessContext = createContext<PlatformAccess | null>(null);

export function usePlatformAccess(): PlatformAccess {
  const access = useContext(PlatformAccessContext);
  if (!access) throw new Error("PlatformGate is required for canvas access");
  return access;
}

type GatePhase =
  | "checking"
  | "required"
  | "connecting"
  | "account"
  | "permission"
  | "developer"
  | "unavailable"
  | "ready";
type PlatformClient = Pick<
  ReturnType<typeof createAppClient>,
  "appId" | "platform" | "auth" | "storage"
>;

function loginMessage(message: string): string {
  return message
    .replaceAll("重新连接账户", "重新登录")
    .replaceAll("请连接账户", "请重新登录")
    .replaceAll("连接账户", "登录并进入画布");
}

function isStandaloneDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return (window as Window & {
    proxyApp?: { agent?: { target?: string } };
  }).proxyApp?.agent?.target === "desktop";
}

const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export default function PlatformGate({
  client,
  children,
}: {
  client: PlatformClient;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<GatePhase>("checking");
  const [message, setMessage] = useState("");
  const [retryFeedback, setRetryFeedback] = useState("");
  const [rechecking, setRechecking] = useState(false);
  const [hostLoginRequired, setHostLoginRequired] = useState(false);
  const [switchDeveloperAccount, setSwitchDeveloperAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [admitted, setAdmitted] = useState(false);
  const [accountScope, setAccountScope] = useState("");
  const [revision, setRevision] = useState(0);
  const active = useRef(true);
  const request = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const modalRef = useRef<HTMLDialogElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blocked = phase !== "ready";
  const busy = phase === "checking" || phase === "connecting";
  // Platform admission is a prerequisite for mounting Workspace. Keep this
  // transient check lightweight; Workspace owns the actual canvas bootstrap
  // animation after admission, while the full card is reserved for states
  // that require user action.
  const checking = phase === "checking";
  const hostedLogin = client.auth.loginMode === "host" || hostLoginRequired;
  const redirectLogin = client.auth.recoveryMode === "redirect";
  const desktopPasswordLogin = isStandaloneDesktopRuntime() && !hostedLogin;
  // A returning workspace must replace the expired authorization. Initial
  // login and account-scope recovery can reuse the normal flow only when the
  // editor has not already been admitted.
  const requireFreshLogin = admitted || phase === "account";

  // The gate is mounted before Workspace. Its blocking state always wins over
  // an editor kept alive behind a returning-login modal.
  useEffect(() => {
    if (phase === "ready") return;
    const status = phase === "checking"
      ? { state: "loading" as const, reason: "正在检查平台连接与登录状态", retryable: true, nextAction: { type: "wait" as const } }
      : phase === "required" || phase === "connecting"
        ? { state: "auth_required" as const, reason: redirectLogin ? "请返回平台恢复应用会话" : hostedLogin ? "请在平台完成登录后重新检查登录状态" : "请在 Canvas 登录窗口完成登录", retryable: hostedLogin, nextAction: { type: "user_login" as const } }
        : phase === "account"
          ? { state: "error" as const, reason: hostedLogin ? "暂时无法确认账户信息，请返回平台确认登录状态后重试。" : "暂时无法确认账户信息，请重新登录；如果仍无法进入，请联系平台管理员。", retryable: true, nextAction: { type: "user_login" as const } }
          : phase === "permission"
            ? { state: "error" as const, reason: "Canvas 当前无法使用所需功能，请重新打开应用并检查版本配置。", retryable: true, nextAction: { type: "retry" as const } }
          : { state: "error" as const, reason: phase === "developer" ? "应用开发绑定未完成" : "平台连接暂时不可用", retryable: phase !== "developer", nextAction: { type: "retry" as const } };
    return agent.setStatus(status, { scope: "canvas.platform", priority: 100 });
  }, [hostedLogin, redirectLogin, phase]);

  const admit = useCallback(async (scope: string | undefined, attempt: number) => {
    if (!scope) throw Object.assign(new Error("平台未返回有效的账户标识"), {
      code: "APP_ACCOUNT_SCOPE_UNAVAILABLE",
    });
    await prepareLocalStorageScope(scope);
    if (!active.current || attempt !== request.current) return;
    setLocalStorageScope(scope);
    setAccountScope(scope);
    migratePreAuthCanvasDiagnostics();
    recordCanvasDiagnostic("info", "platform.session_admitted", { component: "platform_gate", operation: "create_session", result: "succeeded" });
    resumeDocumentStorage(client.storage);
    setAdmitted(true);
    setRevision((value) => value + 1);
    setMessage("");
    setRetryFeedback("");
    setPhase("ready");
  }, [client]);

  const showFailure = useCallback((error: unknown) => {
    const failure = platformFailure(error);
    if (failure.loginMode === "host") setHostLoginRequired(true);
    setMessage(loginMessage(failure.message));
    setSwitchDeveloperAccount(Boolean(failure.switchDeveloperAccount));
    setPhase(
      failure.kind === "login"
        ? "required"
        : failure.kind === "permission"
          ? "permission"
        : failure.kind === "developer"
          ? "developer"
          : failure.kind === "account"
            ? "account"
            : "unavailable",
    );
    return failure;
  }, []);

  const check = useCallback(async (retry = false) => {
    const attempt = ++request.current;
    resetDocumentStorage(client.storage);
    setPhase("checking");
    setRechecking(retry);
    setMessage("");
    setRetryFeedback("");
    try {
      // `createSession()` already validates the local/host session and
      // returns its account scope. Calling `auth.status()` immediately after
      // it caused a second status request during every bootstrap.
      const session = await client.platform.createSession();
      if (!active.current || attempt !== request.current) return;
      if (session.account_scope) await admit(session.account_scope, attempt);
      else {
        setPhase("required");
        if (retry) setRetryFeedback("已重新检查，尚未完成登录。");
      }
    } catch (error) {
      if (active.current && attempt === request.current) {
        const failure = showFailure(error);
        recordCanvasDiagnostic("error", "platform.session_check_failed", {
          component: "platform_gate", operation: "create_session", phase: failure.kind,
          ...diagnosticErrorFields(error),
        });
        if (retry) setRetryFeedback(failure.kind === "account"
          ? "已重新检查，仍无法确认账户信息。"
          : failure.kind === "login"
            ? "已重新检查，仍需完成登录。"
            : "已重新检查，问题仍未解决。请按提示处理后重试。");
      }
    }
  }, [admit, client, showFailure]);

  const login = useCallback(
    async (forceLogin = false) => {
      if (phaseRef.current === "connecting") return;
      if (hostedLogin && !redirectLogin) {
        await check(true);
        return;
      }
      const attempt = ++request.current;
      resetDocumentStorage(client.storage);
      setPhase("connecting");
      setMessage("");
      setRetryFeedback("");
      try {
        // Keep this first asynchronous call within the click's user gesture so
        // the SDK can open its authorization window without popup blocking.
        if (desktopPasswordLogin && (!email.trim() || !password)) {
          setPhase("required");
          setMessage("请输入邮箱和密码登录。");
          return;
        }
        await client.auth.login(
          desktopPasswordLogin
            ? { email: email.trim(), password, ...(forceLogin ? { forceLogin: true } : {}) }
            : forceLogin ? { forceLogin: true } : undefined,
        );
        // Hosted server apps recover through the Portal launcher. Do not
        // reuse this client's terminated session while navigation is pending.
        if (redirectLogin) return;
        const status = await client.auth.status();
        if (!active.current || attempt !== request.current) return;
        if (status.authenticated) {
          setPassword("");
          await admit(status.accountScope, attempt);
        }
        else {
          setPhase("required");
          setMessage("尚未完成登录，请在登录窗口中完成授权后重试。");
        }
      } catch (error) {
        if (active.current && attempt === request.current) {
          const failure = showFailure(error);
          recordCanvasDiagnostic("error", "platform.login_failed", {
            component: "platform_gate", operation: "login", phase: failure.kind,
            ...diagnosticErrorFields(error),
          });
        }
      }
    },
    [admit, check, client, desktopPasswordLogin, email, hostedLogin, redirectLogin, password, showFailure],
  );

  const requireLogin = useCallback((reason?: string) => {
    // Parallel model/storage failures must not interrupt a login the user
    // has already started in the authorization window.
    if (phaseRef.current === "connecting") return;
    request.current += 1;
    resetDocumentStorage(client.storage);
    setRetryFeedback("");
    setMessage(
      reason ? loginMessage(reason) : "登录状态已失效，请重新登录以继续创作。",
    );
    setPhase("required");
  }, [client]);

  useEffect(() => {
    const sessionEnded = (event: Event) => {
      const detail = (event as CustomEvent<{ appId?: string; code?: string }>).detail;
      if (!detail || detail.appId !== client.appId) return;
      // Suspend storage synchronously, before React updates the blocking
      // dialog. Old saves must never resume under another account's Cookie.
      request.current += 1;
      recordCanvasDiagnostic("warn", "platform.session_ended", {
        component: "platform_gate", operation: "session_ended", error_code: detail.code || "APP_AUTH_CHANGED",
      });
      resetDocumentStorage(client.storage);
      setRetryFeedback("");
      setMessage(loginMessage(platformFailure({ code: detail.code || "APP_AUTH_CHANGED" }).message));
      setPhase("required");
    };
    window.addEventListener("proxy-app:session-ended", sessionEnded);
    return () => window.removeEventListener("proxy-app:session-ended", sessionEnded);
  }, [client]);

  useEffect(() => {
    active.current = true;
    void check();
    return () => {
      active.current = false;
      request.current += 1;
      resetDocumentStorage(client.storage);
    };
  }, [check]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (blocked) content.setAttribute("inert", "");
    else content.removeAttribute("inert");
  }, [blocked, admitted]);

  useLayoutEffect(() => {
    if (!blocked) return;
    const modal = modalRef.current;
    if (!modal) return;
    // Native modal isolation also covers the library's portals in <body>.
    // Keeping the editor mounted preserves its draft and undo history.
    modal.showModal();
    return () => modal.close();
  }, [blocked]);

  useEffect(() => {
    if (!blocked) return;
    const previousFocus = document.activeElement;
    const focusDialog = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const target = dialog.querySelector<HTMLElement>(focusableSelector);
      (target || dialog).focus({ preventScroll: true });
    };
    focusDialog();
    const containFocus = (event: FocusEvent) => {
      if (!dialogRef.current?.contains(event.target as Node)) focusDialog();
    };
    const trapKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const targets = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const first = targets[0];
      const last = targets[targets.length - 1];
      event.stopImmediatePropagation();
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", containFocus);
    window.addEventListener("keydown", trapKeyboard, true);
    return () => {
      document.removeEventListener("focusin", containFocus);
      window.removeEventListener("keydown", trapKeyboard, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [blocked]);

  useEffect(() => {
    if (!blocked) return;
    const dialog = dialogRef.current;
    const target = dialog?.querySelector<HTMLElement>(focusableSelector);
    (target || dialog)?.focus({ preventScroll: true });
  }, [blocked, phase]);

  const access = useMemo(
    () => ({ ready: !blocked, revision, requireLogin }),
    [blocked, revision, requireLogin],
  );
  const title = phase === "checking"
    ? rechecking ? "正在重新检查平台连接" : "正在连接平台"
    : phase === "developer"
      ? "开发应用配置未完成"
      : phase === "account"
        ? "暂时无法确认账户信息"
        : phase === "permission"
          ? "应用功能暂不可用"
        : phase === "unavailable"
          ? "暂时无法连接平台"
          : redirectLogin
            ? "恢复登录，继续创作"
          : hostedLogin
            ? "请先在平台登录"
            : admitted
              ? "重新登录，继续创作"
              : "登录后开始创作";

  return (
    <PlatformAccessContext.Provider value={access}>
      <div
        ref={contentRef}
        className="platform-gate-content"
        aria-hidden={blocked || undefined}
      >
        {admitted && <Fragment key={accountScope}>{children}</Fragment>}
      </div>
      {blocked && (
        <dialog
          ref={modalRef}
          className={`platform-gate-overlay${admitted ? " is-returning" : ""}`}
          aria-modal="true"
          aria-label={title}
          aria-describedby={checking ? undefined : "platform-gate-description"}
          aria-busy={busy}
          onCancel={(event) => event.preventDefault()}
        >
          <div
            ref={dialogRef}
            className={`platform-gate-dialog${checking ? " is-checking" : ""}`}
            tabIndex={-1}
          >
            {checking ? (
              <div
                className="platform-gate-loading-only"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <LoaderCircle
                  className="platform-gate-spinner"
                  size={18}
                  aria-hidden="true"
                />
                <span>{rechecking ? "正在重新检查平台连接…" : "正在连接平台…"}</span>
              </div>
            ) : (
            <StartupScreen
              title={title}
              description={phase === "developer"
                  ? "本地应用的开发登记未完成，暂时无法创建运行会话。"
                : phase === "account"
                    ? hostedLogin
                      ? `${admitted ? "当前画布已保留。" : "为保护你的画布数据，暂时无法进入。"}请返回平台确认登录状态后重试。`
                      : admitted
                        ? "当前画布已保留。请重新登录，确认账户信息后继续创作。"
                        : "为保护你的画布数据，暂时无法进入。请重新登录后再试。"
                    : phase === "permission"
                      ? "请重新打开应用后重试。如果仍无法使用，请联系应用开发者检查版本配置与应用权限。"
                    : phase === "unavailable"
                      ? "连接恢复后，即可继续进入画布。"
                      : redirectLogin
                        ? `${admitted ? "当前画布已暂停同步。" : "应用会话需要恢复。"}返回平台验证登录后，将回到当前页面。`
                      : hostedLogin
                        ? `${admitted ? "当前画布已保留。" : "当前环境由平台管理登录。"}请在平台完成登录后重试。`
                        : admitted
                          ? "当前画布已保留，完成登录后会继续同步画布与模型。"
                          : "一次完成登录、模型加载和云端画布同步，进入后即可开始创作。"}
              showBenefits={(phase === "required" || phase === "connecting") && !admitted && !hostedLogin}
              message={phase === "account" ? undefined : message}
              technicalDetails={phase === "account"
                ? `${message} 错误代码：APP_ACCOUNT_SCOPE_UNAVAILABLE`
                : undefined}
              status={phase === "connecting"
                  ? "等待登录完成…"
                  : retryFeedback || undefined}
              credentialFields={desktopPasswordLogin && (phase === "required" || phase === "account") ? (
                <form
                  className="platform-gate-credentials"
                  onSubmit={(event) => {
                    event.preventDefault();
                    // An admitted workspace means the current session expired
                    // in place. Force a fresh platform authorization instead
                    // of reusing the relay's stale login state.
                    void login(requireFreshLogin);
                  }}
                >
                  <label>
                    邮箱
                    <input
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      disabled={busy}
                    />
                  </label>
                  <label>
                    密码
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入密码"
                      disabled={busy}
                    />
                  </label>
                </form>
              ) : undefined}
              busy={busy}
              action={phase === "unavailable" || phase === "developer" || phase === "permission"
                ? {
                    label: phase === "developer" ? "重新检查应用绑定" : "重新检查连接",
                    onClick: () => void check(true),
                    icon: <RefreshCw size={17} aria-hidden="true" />,
                  }
                : redirectLogin
                  ? {
                      label: phase === "connecting" ? "正在返回平台…" : "返回平台恢复登录",
                      onClick: () => void login(),
                      disabled: phase === "connecting",
                      icon: phase === "connecting" ? <LoaderCircle className="platform-gate-spinner" size={18} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />,
                    }
                : hostedLogin
                  ? {
                      label: "重新检查登录状态",
                      onClick: () => void check(true),
                      icon: <RefreshCw size={17} aria-hidden="true" />,
                    }
                  : {
                      label: phase === "connecting" ? "等待登录完成…" : admitted || phase === "account" ? "重新登录" : "登录并进入画布",
                      // Once the editor has been admitted, a normal login can
                      // silently reuse the expired authorization. Explicitly
                      // force reauthorization so the new App Session is
                      // issued before the workspace resumes.
                      onClick: () => void login(requireFreshLogin),
                      disabled: phase === "connecting" || (desktopPasswordLogin && (!email.trim() || !password)),
                      icon: phase === "connecting" ? <LoaderCircle className="platform-gate-spinner" size={18} aria-hidden="true" /> : undefined,
                    }}
              secondaryAction={phase === "account" && !hostedLogin
                ? {
                    label: "重试",
                    onClick: () => void check(true),
                  }
                : phase === "developer" && switchDeveloperAccount && !hostedLogin
                  ? {
                      label: "使用其他开发账户登录",
                      onClick: () => void login(true),
                    }
                  : undefined}
              hint={phase === "connecting"
                ? "请在打开的登录窗口中完成授权，完成后将自动继续加载。"
                : phase === "permission"
                  ? "应用可直接打开，无需安装或另行确认权限。"
                : redirectLogin && (phase === "account" || phase === "required")
                  ? "平台仍处于登录状态时会自动恢复，无需再次输入密码。"
                : hostedLogin && (phase === "account" || phase === "required")
                  ? "如果仍无法进入，请在平台重新打开应用，或联系平台管理员。"
                  : phase === "account"
                    ? "重新登录后仍无法进入，请更新平台或桌面客户端，并联系管理员检查账户信息接口。"
                    : phase === "required" && !admitted
                      ? "将打开平台登录窗口，完成后自动进入画布。"
                      : undefined}
            />
            )}
          </div>
        </dialog>
      )}
    </PlatformAccessContext.Provider>
  );
}
