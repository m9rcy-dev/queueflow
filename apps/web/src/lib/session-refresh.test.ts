import { describe, expect, it } from "vitest";
import { CustomerApiClient, StaffApiClient } from "@queueflow/api-client";

/**
 * Phase 20 regression test: refresh tokens are single-use, and two session
 * restores at once (React runs start-up effects twice in development; a page
 * can restore from two places) used to race — the second presented the
 * already-used token, was refused, and wiped the session (customers bounced
 * to "nothing to see at this address" right after signing in on a phone).
 * Concurrent restores must share one refresh.
 */
function fakeApi(prefix: string) {
  let valid = `${prefix}-0`;
  let issued = 0;
  let refreshCalls = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refresh")) {
      refreshCalls += 1;
      const { refreshToken } = JSON.parse(String(init?.body));
      await new Promise((resolve) => setTimeout(resolve, 20)); // a slow phone network
      if (refreshToken !== valid) return new Response("{}", { status: 401 });
      issued += 1;
      valid = `${prefix}-${issued}`;
      return Response.json({ accessToken: "access", refreshToken: valid });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  return { fetchImpl, refreshCalls: () => refreshCalls };
}

function memoryStorage(initial: string) {
  let token: string | null = initial;
  return {
    getRefreshToken: () => token,
    setRefreshToken: (next: string | null) => {
      token = next;
    },
    getDeviceTrustToken: () => null,
    setDeviceTrustToken: () => undefined,
    current: () => token,
  };
}

describe("concurrent session restores share one refresh (Phase 20)", () => {
  it("keeps a customer signed in", async () => {
    const api = fakeApi("c");
    const storage = memoryStorage("c-0");
    const client = new CustomerApiClient({
      baseUrl: "http://api",
      tokenStorage: storage,
      fetchImpl: api.fetchImpl,
    });
    const [first, second] = await Promise.all([client.restoreSession(), client.restoreSession()]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(api.refreshCalls()).toBe(1);
    expect(storage.current()).toBe("c-1");
  });

  it("keeps staff signed in", async () => {
    const api = fakeApi("s");
    const storage = memoryStorage("s-0");
    const client = new StaffApiClient({
      baseUrl: "http://api",
      tokenStorage: storage,
      fetchImpl: api.fetchImpl,
    });
    const [first, second] = await Promise.all([client.restoreSession(), client.restoreSession()]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(api.refreshCalls()).toBe(1);
  });

  it("uses a token another tab just rotated instead of signing out", async () => {
    const api = fakeApi("t");
    const storage = memoryStorage("t-0");
    const otherTab = new CustomerApiClient({
      baseUrl: "http://api",
      tokenStorage: storage,
      fetchImpl: api.fetchImpl,
    });
    // This tab read the old token, then the other tab rotated it.
    let reads = 0;
    const staleFirstRead = {
      ...storage,
      getRefreshToken: () => (reads++ === 0 ? "t-0" : storage.current()),
    };
    const thisTab = new CustomerApiClient({
      baseUrl: "http://api",
      tokenStorage: staleFirstRead,
      fetchImpl: api.fetchImpl,
    });
    await otherTab.restoreSession();
    expect(await thisTab.restoreSession()).not.toBeNull();
    expect(storage.current()).not.toBeNull();
  });
});
