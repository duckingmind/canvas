import type { AppProfile } from "@ducking-mind/proxy-app-sdk";

/**
 * Normalize the SDK result and older host/relay envelopes for the account UI.
 * A stable user ID is required by the Gateway profile contract; malformed
 * profile data is treated as unavailable rather than presented as an account.
 */
export function normalizePlatformProfile(value: unknown): AppProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const source = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
  const text = (key: string) => typeof source[key] === "string" && source[key].trim()
    ? source[key].trim()
    : undefined;
  const id = text("id");
  if (!id) return null;
  const email = text("email");
  const username = text("username");
  const name = text("name");
  const avatar_url = text("avatar_url");
  return {
    id,
    ...(email ? { email } : {}),
    ...(username ? { username } : {}),
    ...(name ? { name } : {}),
    ...(avatar_url ? { avatar_url } : {}),
  };
}
