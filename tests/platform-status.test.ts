import assert from "node:assert/strict";
import test from "node:test";
import { platformFailure } from "../src/platform-status.ts";

test("missing local runtime gives a development setup action, not a login or no-model warning", () => {
  const failure = platformFailure({ code: "LOCAL_DEV_RUNTIME_NOT_CONFIGURED" });
  assert.equal(failure.kind, "runtime");
  assert.match(failure.message, /npm run dev/);
  assert.doesNotMatch(failure.message, /没有模型|无可用模型/);
});

test("local development registration failures explain the owner-only boundary", () => {
  const failure = platformFailure({
    code: "APP_APP_REGISTRATION_FAILED",
    status: 404,
    message: "应用不存在，或当前账户不是应用创建者。",
  });
  assert.equal(failure.kind, "developer");
  assert.match(failure.message, /应用创建者/);
  assert.match(failure.message, /已发布应用/);
  assert.equal(failure.switchDeveloperAccount, true);
});

test("development session errors stay separate from normal user login", () => {
  const denied = platformFailure({ code: "APP_DEVELOPMENT_ACCESS_DENIED", status: 403 });
  assert.equal(denied.kind, "developer");
  assert.equal(denied.switchDeveloperAccount, true);
  assert.match(denied.message, /创建者账户/);
  assert.match(denied.message, /普通用户/);
  assert.doesNotMatch(denied.message, /重新登录|连接账户/);

  const missingVersion = platformFailure({ code: "APP_DEVELOPMENT_VERSION_NOT_FOUND", status: 404 });
  assert.equal(missingVersion.kind, "developer");
  assert.match(missingVersion.message, /manifest\.version/);
  assert.equal(missingVersion.switchDeveloperAccount, undefined);

  const missingApp = platformFailure({ code: "APP_DEVELOPMENT_APP_UNAVAILABLE", status: 404 });
  assert.equal(missingApp.kind, "developer");
  assert.match(missingApp.message, /应用标识/);
});

test("registration permission, version conflict and outage keep distinct recovery paths", () => {
  const denied = platformFailure({
    code: "APP_LOGIN_NOT_ALLOWED",
    status: 403,
    details: { stage: "app_registration" },
  });
  assert.equal(denied.kind, "developer");
  assert.equal(denied.switchDeveloperAccount, true);
  const conflict = platformFailure({
    code: "APP_APP_REGISTRATION_FAILED",
    status: 409,
    message: "本地 manifest 与已发布版本不同，请更新 manifest.version。",
  });
  assert.equal(conflict.kind, "developer");
  assert.match(conflict.message, /manifest.version/);
  assert.doesNotMatch(conflict.message, /应用创建者/);
  assert.equal(conflict.switchDeveloperAccount, undefined);
  assert.equal(
    platformFailure({ code: "APP_APP_REGISTRATION_FAILED", status: 503 }).kind,
    "service",
  );
});

test("login actions distinguish required, blocked, cancelled, expired and denied authorization", () => {
  const cases = [
    ["APP_LOGIN_REQUIRED", /连接账户/],
    ["APP_LOGIN_POPUP_BLOCKED", /允许弹窗/],
    ["APP_LOGIN_TIMEOUT", /超时/],
    ["APP_LOGIN_CANCELLED", /已取消/],
    ["APP_LOGIN_SESSION_EXPIRED", /已失效/],
    ["APP_LOGIN_TOKEN_INVALID", /有效授权/],
    ["APP_LOGIN_NOT_ALLOWED", /有权限的账户/],
    ["APP_SESSION_UNAVAILABLE", /连接账户/],
    ["APP_SESSION_EXPIRED", /已过期/],
    ["APP_SESSION_INVALID", /无效/],
    ["LOGIN_CREDENTIALS_REQUIRED", /邮箱和密码/],
  ] as const;
  for (const [code, expected] of cases) {
    const failure = platformFailure(
      Object.assign(new Error("technical internal message"), { code }),
    );
    assert.equal(failure.kind, "login", code);
    assert.match(failure.message, expected, code);
  }
});

test("standalone desktop credential failures remain recoverable as login", () => {
  assert.deepEqual(platformFailure({
    status: 401,
    code: "PLATFORM_API_ERROR",
    message: "邮箱或密码错误",
  }), {
    kind: "login",
    message: "邮箱或密码错误，请检查后重试。",
  });
});

test("account changes stop the current workspace instead of becoming a generic retry", () => {
  for (const code of ["APP_AUTH_CHANGED", "APP_ACCOUNT_CHANGED", "APP_VERSION_CHANGED"]) {
    const failure = platformFailure({ code, status: 409, message: "account_scope=confidential" });
    assert.equal(failure.kind, "login");
    assert.match(failure.message, /重新/);
    assert.doesNotMatch(failure.message, /confidential/);
  }
});

test("Gateway application credential failures use an actionable reauthorization message", () => {
  assert.deepEqual(platformFailure({
    status: 401,
    code: "credential_invalid",
    message: "application credential is invalid or expired",
  }), {
    kind: "login",
    message: "平台授权已失效，请重新连接账户后继续创作。",
  });
  assert.deepEqual(platformFailure({
    status: 401,
    code: "credential_invalid",
    authReason: "APP_SESSION_EXPIRED",
    executionStarted: false,
  }), {
    kind: "login",
    message: "平台授权已过期，请重新连接账户后继续创作。",
  });
});

test("SDK nested authorization errors are classified without copying sensitive details", () => {
  const failure = platformFailure({
    details: {
      error: { code: "APP_LOGIN_REQUIRED" },
      login_url: "https://example.test/callback?token=secret",
    },
  });
  assert.equal(failure.kind, "login");
  assert.doesNotMatch(failure.message, /secret|https:/);
});

test("host-managed login tells the app to offer a status retry instead of another login", () => {
  assert.deepEqual(platformFailure({
    details: { error: { code: "APP_LOGIN_UNAVAILABLE", message: "access_token=confidential" } },
  }), {
    kind: "login",
    message: "当前环境由平台管理登录，请在平台中重新打开应用。",
    loginMode: "host",
  });
});

test("missing account scope has a distinct recovery path with a safe diagnostic", () => {
  const code = "APP_ACCOUNT_SCOPE_UNAVAILABLE";
  for (const error of [
    Object.assign(new Error("Authorization: Bearer confidential"), { code }),
    { code, message: "平台尚未提供账户隔离标识，请更新平台后重新登录。" },
    { error: { code, message: "access_token=confidential" } },
    {
      details: {
        error: { code },
        login_url: "https://example.test/callback?token=confidential",
        account_scope: "confidential-account-id",
      },
    },
  ]) {
    const failure = platformFailure(error);
    assert.deepEqual(failure, {
      kind: "account",
      message: "平台未返回有效的账户标识，可能与登录会话或平台配置有关。",
    });
    assert.doesNotMatch(
      failure.message,
      /confidential|Bearer|https:|隔离标识|更新平台/,
    );
  }
});

test("a legacy installation error diagnoses an outdated platform", () => {
  const failure = platformFailure({
    code: "APP_NOT_INSTALLED",
    message: "请先在主应用中获取此应用",
  });
  assert.deepEqual(failure, {
    kind: "service",
    message: "平台仍在使用旧版应用安装校验，请更新平台服务后重新打开 Canvas。",
  });
});

test("authenticated users see a deployment diagnosis when the app session route is missing", () => {
  for (const error of [
    { code: "APP_SESSION_ROUTE_UNAVAILABLE", status: 404 },
    { code: "APP_DATA_PLANE_ROUTE_NOT_FOUND", status: 404 },
    { status: 404, message: "404 page not found" },
  ]) {
    const failure = platformFailure(error);
    assert.equal(failure.kind, "service");
    assert.match(failure.message, /未部署.*会话接口/);
    assert.doesNotMatch(failure.message, /重新登录|连接账户/);
  }
});

test("permission denial points to app configuration without asking for installation or login", () => {
  const failure = platformFailure({ code: "APP_PERMISSION_DENIED", status: 403 });
  assert.equal(failure.kind, "permission");
  assert.match(failure.message, /应用权限/);
  assert.match(failure.message, /版本配置/);
    assert.doesNotMatch(failure.message, /应用市场|重新确认|先安装/);
  assert.doesNotMatch(failure.message, /重新登录|连接账户/);
});

test("legacy plain permission errors keep the configuration recovery path", () => {
  for (const error of [
    {
      code: "PLATFORM_API_ERROR",
      status: 403,
      message: "app permission denied",
    },
    { status: 403, error: "permission denied" },
  ]) {
    const failure = platformFailure(error);
    assert.equal(failure.kind, "permission");
    assert.match(failure.message, /版本配置/);
    assert.doesNotMatch(failure.message, /应用市场|重新确认|先安装/);
  }
});

test("session and data-plane configuration errors do not ask an authenticated user to log in again", () => {
  const cases = [
    ["APP_SESSION_SERVICE_UNAVAILABLE", /会话服务/],
    ["APP_SESSION_SIGNING_NOT_CONFIGURED", /会话签名/],
    ["APP_DATA_PLANE_NOT_CONFIGURED", /数据网关/],
  ] as const;
  for (const [code, expected] of cases) {
    const failure = platformFailure({ code, status: 503 });
    assert.equal(failure.kind, "service", code);
    assert.match(failure.message, expected, code);
    assert.doesNotMatch(failure.message, /重新登录|连接账户/, code);
  }
});

test("network transport and timeout errors get actionable Chinese messages", () => {
  for (const error of [
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new Error("NetworkError when attempting to fetch resource."),
    { code: "APP_PLATFORM_UNAVAILABLE" },
    { code: "APP_GATEWAY_UNAVAILABLE", error: "fetch failed" },
    { code: "LOCAL_DEV_RELAY_ERROR", error: "fetch failed" },
    { code: "APP_PLATFORM_TIMEOUT" },
    { code: "APP_SESSION_REFRESH_TIMEOUT" },
  ]) {
    const failure = platformFailure(error);
    assert.equal(failure.kind, "network");
    assert.match(failure.message, /重试/);
  }
});

test("relay transport failures identify gateway recovery without exposing raw errors", () => {
  const failure = platformFailure({
    details: { code: "APP_GATEWAY_UNAVAILABLE", error: "fetch failed: Authorization: Bearer secret" },
  });
  assert.equal(failure.kind, "network");
  assert.match(failure.message, /网关服务/);
  assert.doesNotMatch(failure.message, /secret|Bearer|fetch failed/);
});

test("service failure preserves safe relay diagnosis and does not mistake session creation failure for missing login", () => {
  const message = "应用开发登记服务暂不可用，请稍后重试。";
  assert.deepEqual(
    platformFailure({ code: "APP_APP_REGISTRATION_FAILED", message }),
    { kind: "service", message },
  );
  assert.equal(
    platformFailure({
      code: "APP_SESSION_CREATE_FAILED",
      message: "平台授权创建失败，请稍后重试。",
    }).kind,
    "service",
  );
});

test("raw response bodies and credentials cannot leak into fallback messages", () => {
  for (const message of [
    "<html>502 Bad Gateway</html>",
    '{"access_token":"secret"}',
    "Authorization: Bearer confidential",
    "access_token=confidential",
    "Try https://example.test/callback?token=confidential",
    "Failed: eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "Response: " + "x".repeat(256),
  ]) {
    assert.deepEqual(platformFailure(new Error(message)), {
      kind: "service",
      message: "平台服务暂不可用，请稍后重试。",
    });
  }
});

test("unknown failures and model payloads do not invent an authentication error", () => {
  for (const value of [undefined, null, "", {}, { data: [] }])
    assert.deepEqual(platformFailure(value), {
      kind: "service",
      message: "平台服务暂不可用，请稍后重试。",
    });
});
