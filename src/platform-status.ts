export type PlatformFailure = {
  kind:
    | "runtime"
    | "login"
    | "account"
    | "permission"
    | "developer"
    | "network"
    | "service";
  message: string;
  switchDeveloperAccount?: boolean;
  loginMode?: "host";
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const loginMessages: Record<string, string> = {
  APP_LOGIN_REQUIRED: "尚未连接平台账户，请点击“连接账户”完成登录授权。",
  APP_LOGIN_POPUP_BLOCKED:
    "浏览器阻止了登录窗口，请允许弹窗后点击“连接账户”重试。",
  APP_LOGIN_TIMEOUT: "平台登录超时，请点击“连接账户”重试。",
  APP_LOGIN_CANCELLED: "登录已取消，可点击“连接账户”重新授权。",
  APP_LOGIN_SESSION_EXPIRED: "平台登录已失效，请重新连接账户。",
  APP_LOGIN_TOKEN_INVALID: "平台未返回有效授权，请重新连接账户。",
  APP_LOGIN_NOT_ALLOWED: "当前账户无权使用此应用，请使用有权限的账户登录。",
  APP_LOGIN_STATE_INVALID: "本次登录请求已失效，请重新连接账户。",
  APP_LOGIN_FAILED: "平台登录失败，请重新连接账户。",
  APP_LOGIN_UNAVAILABLE: "当前环境由平台管理登录，请在平台中重新打开应用。",
  APP_SESSION_EXPIRED: "平台授权已过期，请重新连接账户。",
  APP_SESSION_REVOKED: "平台授权已撤销，请重新连接账户。",
  APP_SESSION_INVALID: "平台授权无效，请重新连接账户。",
  APP_SESSION_UNAVAILABLE: "尚未取得平台授权，请连接账户。",
  APP_SESSION_REFRESH_UNAVAILABLE: "平台授权无法自动恢复，请重新连接账户。",
  APP_SESSION_REFRESH_FAILED: "平台授权恢复失败，请重新连接账户。",
  APP_AUTH_CHANGED: "账户授权已改变，请重新加载应用恢复连接。",
  APP_ACCOUNT_CHANGED: "平台账户已切换，当前画布已暂停同步。请重新打开应用后继续。",
  APP_VERSION_CHANGED: "应用版本已更新，请重新打开应用后继续。",
  LOGIN_CREDENTIALS_REQUIRED: "请输入邮箱和密码登录。",
};

// Only display a short plain message. SDK details may contain login callback
// URLs, session tokens or the raw upstream response and must never enter UI.
function safeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  if (
    !message ||
    message.length > 240 ||
    /[\r\n\x00-\x1f]|https?:\/\/|[<>]|^[{[]/i.test(message) ||
    /(?:bearer\s+|(?:token|authorization|password|secret|api[_-]?key)\s*[=:]|eyJ[\w-]+\.|[A-Za-z0-9_-]{40,})/i.test(
      message,
    )
  )
    return undefined;
  return message;
}

/** Classify a failed platform operation; an empty model list is a separate state. */
export function platformFailure(error: unknown): PlatformFailure {
  const body = record(error);
  const details = record(body.details);
  const entries = [body, record(body.error), details, record(details.error)];
  const code = entries
    .flatMap((entry) => [entry.code, entry.error_code])
    .find((value): value is string => typeof value === "string")
    ?.toUpperCase();
  const status = entries
    .flatMap((entry) => [entry.status, entry.statusCode])
    .find((value): value is number => typeof value === "number");
  const authReason = entries
    .map((entry) => entry.authReason || entry.auth_reason)
    .find((value): value is string => typeof value === "string")
    ?.toUpperCase();
  if (code === "CREDENTIAL_INVALID" || (status === 401 && authReason === "APP_SESSION_EXPIRED"))
    return {
      kind: "login",
      message: authReason === "APP_SESSION_EXPIRED"
        ? "平台授权已过期，请重新连接账户后继续创作。"
        : "平台授权已失效，请重新连接账户后继续创作。",
    };
  if (code === "APP_ACCOUNT_SCOPE_UNAVAILABLE")
    return {
      kind: "account",
      message: "平台未返回有效的账户标识，可能与登录会话或平台配置有关。",
    };
  if (code === "APP_NOT_INSTALLED")
    return {
      kind: "service",
      message:
        "平台仍在使用旧版应用安装校验，请更新平台服务后重新打开 Canvas。",
    };
  if (code === "APP_PERMISSION_DENIED")
    return {
      kind: "permission",
      message:
        "Canvas 当前无法使用此功能，请重新打开应用；若仍不可用，请联系应用开发者检查版本配置与应用权限。",
    };
  if (code === "APP_SESSION_ROUTE_UNAVAILABLE" || code === "APP_DATA_PLANE_ROUTE_NOT_FOUND")
    return {
      kind: "service",
      message:
        "主应用已登录，但当前平台未部署 Canvas 会话接口。请更新桌面端和平台服务后重试，或联系平台管理员。",
    };
  if (code === "APP_SESSION_SERVICE_UNAVAILABLE")
    return {
      kind: "service",
      message: "主应用已登录，但 Canvas 会话服务暂时不可用，请稍后重试。",
    };
  if (code === "APP_SESSION_SIGNING_NOT_CONFIGURED")
    return {
      kind: "service",
      message: "主应用已登录，但平台未配置 Canvas 会话签名，请联系平台管理员。无需重复登录。",
    };
  if (code === "APP_DATA_PLANE_NOT_CONFIGURED" || code === "APP_PUBLIC_GATEWAY_NOT_CONFIGURED")
    return {
      kind: "service",
      message: "主应用已登录，但平台未配置 Canvas 数据网关，请联系平台管理员。无需重复登录。",
    };
  if (code === "APP_SESSION_NOT_FOUND")
    return {
      kind: "service",
      message: "Canvas 会话不存在或已失效，请返回主应用重新打开应用。",
    };
  if (code === "APP_DEVELOPMENT_ACCESS_DENIED" || code === "APP_DEVELOPMENT_APP_UNAVAILABLE")
    return {
      kind: "developer",
      switchDeveloperAccount: true,
      message: "当前账号无法访问此本地开发预览。请核对应用标识并使用创建者账户；普通用户请从已发布应用入口打开。",
    };
  if (code === "APP_DEVELOPMENT_VERSION_NOT_FOUND")
    return {
      kind: "developer",
      message: "本地应用版本未登记。请让 manifest.version 与平台登记版本一致后重试。",
    };
  if (code === "APP_LOGIN_UNAVAILABLE")
    return {
      kind: "login",
      message: loginMessages.APP_LOGIN_UNAVAILABLE,
      loginMode: "host",
    };
  if (code === "LOGIN_CREDENTIALS_REQUIRED")
    return { kind: "login", message: loginMessages.LOGIN_CREDENTIALS_REQUIRED };
  if (
    status === 401 && /邮箱或密码错误|凭证无效|invalid credentials|invalid password/i.test(
      entries.map((entry) => (typeof entry.message === "string" ? entry.message : "")).join(" "),
    )
  )
    return { kind: "login", message: "邮箱或密码错误，请检查后重试。" };
  if (code === "LOCAL_DEV_RUNTIME_NOT_CONFIGURED")
    return {
      kind: "runtime",
      message: "本地预览未连接平台，请在应用目录运行 npm run dev 后再连接账户。",
    };
  const registrationFailure =
    code === "APP_APP_REGISTRATION_FAILED" ||
    (code === "APP_LOGIN_NOT_ALLOWED" &&
      entries.some((entry) => entry.stage === "app_registration"));
  if (registrationFailure) {
    const status = entries
      .flatMap((entry) => [entry.status, entry.statusCode])
      .find((value): value is number => typeof value === "number");
    const diagnostic = entries
      .map((entry) => safeMessage(entry.message))
      .find(Boolean);
    if (
      status === 403 ||
      status === 404 ||
      /应用创建者|无权开发|not found/i.test(diagnostic || "")
    )
      return {
        kind: "developer",
        switchDeveloperAccount: true,
        message:
          "本地开发登记未通过：应用可能不存在，或当前账户没有开发权限。请核对 manifest.json 中的应用 slug 与平台环境；本地调试需应用创建者账户，普通用户请从已发布应用入口使用。",
      };
    if (
      status === 409 ||
      entries.some(
        (entry) => entry.upstream_code === "APP_LOCAL_MANIFEST_CONFLICT",
      )
    )
      return {
        kind: "developer",
        message:
          diagnostic ||
          "本地应用版本配置存在冲突，请检查 manifest.version 与平台已登记的版本后重试。",
      };
  }
  if (code && loginMessages[code])
    return { kind: "login", message: loginMessages[code] };
  if (code?.startsWith("APP_LOGIN_"))
    return { kind: "login", message: "平台登录未完成，请重新连接账户。" };

  const rawMessage = typeof body.message === "string" ? body.message : "";
  const diagnosticText = entries
    .map((entry) =>
      [
        typeof entry.message === "string" ? entry.message : "",
        typeof entry.error === "string" ? entry.error : "",
      ].join(" "),
    )
    .join(" ");
  // Older desktop shells forwarded only the plain upstream body. Restrict the
  // fallback to the characteristic route response so unrelated 404s retain
  // their normal service classification.
  if (
    [404, 405].includes(status || 0) &&
    /^(?:\s*(?:404|405)\s+page\s+not\s+found\s*)$/i.test(diagnosticText.trim())
  )
    return {
      kind: "service",
      message:
        "主应用已登录，但当前平台未部署 Canvas 会话接口。请更新桌面端和平台服务后重试，或联系平台管理员。",
    };
  // A few older platform builds returned a plain 403 message before the
  // structured APP_PERMISSION_DENIED code was introduced. Keep that response
  // on the permission path when it is clearly an app permission failure, while
  // leaving generic account and email-verification errors as service errors.
  if (
    [401, 403].includes(status || 0) &&
    /(?:app\s+(?:permission|access)\s+denied|permission\s+denied|应用权限|权限不足)/i.test(
      diagnosticText,
    )
  )
    return {
      kind: "permission",
      message:
        "Canvas 当前无法使用此功能，请重新打开应用；若仍不可用，请联系应用开发者检查版本配置与应用权限。",
    };
  if (code === "APP_GATEWAY_UNAVAILABLE")
    return {
      kind: "network",
      message: "无法连接生成服务，请确认网关服务已启动后重试。",
    };
  if (code === "LOCAL_DEV_RELAY_ERROR")
    return {
      kind: "network",
      message: "本地转发暂时无法连接平台，请检查平台与网关服务后重试。",
    };
  if (
    code &&
    [
      "APP_PLATFORM_TIMEOUT",
      "APP_BRIDGE_TIMEOUT",
      "APP_SESSION_REFRESH_TIMEOUT",
    ].includes(code)
  )
    return { kind: "network", message: "平台响应超时，请稍后重试。" };
  if (
    (code &&
      ["APP_PLATFORM_UNAVAILABLE", "APP_BRIDGE_DISCONNECTED"].includes(code)) ||
    /failed to fetch|fetch failed|networkerror|network request failed|load failed|ECONNREFUSED|ENOTFOUND/i.test(
      rawMessage,
    )
  )
    return {
      kind: "network",
      message: "无法连接平台，请检查网络和平台服务后重试。",
    };
  return {
    kind: "service",
    message:
      entries.map((entry) => safeMessage(entry.message)).find(Boolean) ||
      "平台服务暂不可用，请稍后重试。",
  };
}
