import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlatformProfile } from "../src/platform-profile.ts";

test("normalizes the Gateway profile envelope for the account card", () => {
  assert.deepEqual(normalizePlatformProfile({
    object: "profile",
    data: {
      id: " user-1 ",
      username: " Canvas creator ",
      email: " creator@example.test ",
      avatar_url: " https://cdn.example.test/avatar.png ",
      phone: "+10000000000",
      balance: 100,
    },
  }), {
    id: "user-1",
    username: "Canvas creator",
    email: "creator@example.test",
    avatar_url: "https://cdn.example.test/avatar.png",
  });
});

test("accepts the SDK-unwrapped profile and rejects malformed identities", () => {
  assert.deepEqual(normalizePlatformProfile({ id: "user-2", name: "Creator" }), {
    id: "user-2",
    name: "Creator",
  });
  assert.equal(normalizePlatformProfile({ email: "creator@example.test" }), null);
  assert.equal(normalizePlatformProfile({ data: [] }), null);
  assert.equal(normalizePlatformProfile(null), null);
});
