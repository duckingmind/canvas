import { createAppClient } from "@ducking-mind/proxy-app-sdk";
import manifest from "../manifest.json";
import { capability } from "./agent-tools.mjs";
import { readGatewaySession } from "./gateway-session.ts";
import { setCanvasLocalDevelopmentEnabled } from "./network-boundary.ts";

setCanvasLocalDevelopmentEnabled(import.meta.env.DEV);

/**
 * The canvas platform client is an application boundary, not an editor
 * concern.  Keeping the singleton here prevents the workspace shell and the
 * editor from importing one another just to reach SDK services.
 */
const localAuth = import.meta.env.DEV
  ? import.meta.env.VITE_CANVAS_FIXTURE_AUTH === "1"
    ? {
        localAuthPath: "/__fixture/auth/start",
        localAuthStatusPath: "/__fixture/auth/status",
        localLogoutPath: "/__fixture/auth/logout",
      }
    : {
        // proxy-app dev exposes authentication through its loopback relay.
        // Keep Canvas off the legacy `/api/app-runtime` path even during
        // local development; model, media and KV traffic still use `/v1`.
        localAuthPath: "/__platform/auth/start",
        localAuthStatusPath: "/__platform/auth/status",
        localLogoutPath: "/__platform/auth/logout",
      }
  : {}

// A server-runtime Canvas is always a top-level document in the Portal.
// Preserve only the explicit Electron bridge as a separate desktop runtime.
const electronHost = typeof window !== "undefined" && Boolean(
  (window as Window & { proxyApp?: unknown }).proxyApp,
);

// Published Canvas pages receive a user-bound App Session from the Portal
// launch handoff.  The document never needs to call the Admin runtime to
// discover or proxy a session: all model, media and KV traffic goes directly
// to the Gateway's canonical `/v1` surface.
const gatewaySession = !import.meta.env.DEV && !electronHost
  ? readGatewaySession(manifest.id)
  : undefined;

export const client = createAppClient(manifest.id, {
  // Published Canvas pages use the direct App Session runtime. Development
  // keeps the loopback relay and Electron keeps its preload transport.
  runtime: import.meta.env.DEV ? "local" : electronHost ? "electron" : "direct",
  localDevelopment: import.meta.env.DEV,
  localAppVersion: manifest.version,
  ...(gatewaySession ? { appSession: gatewaySession } : {}),
  // The fixture uses a disposable auth endpoint. Business data requests still
  // use the App Session gateway (`/v1`) and never use the admin runtime.
  ...localAuth,
});

const unregisterMetadata = client.agent.register(
  capability("read_metadata"),
  async () => ({ appId: manifest.id, version: manifest.version, name: manifest.name }),
);

if (import.meta.hot) import.meta.hot.dispose(unregisterMetadata);
