import { ConfigService } from "@nestjs/config";
import { PingramEmailProvider } from "./pingram-email.provider";

describe("PingramEmailProvider", () => {
  const config: Record<string, string> = {
    PINGRAM_API_KEY: "pingram_sk_test123",
    PINGRAM_FROM_EMAIL: "noreply@q.m9rcy.dev",
  };
  const configService = { get: (key: string) => config[key] } as ConfigService;

  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("posts to Pingram's email endpoint with the API key as a Bearer token, never logged", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ trackingId: "abc" }) });
    const provider = new PingramEmailProvider(configService);

    await provider.send({ to: "alice@example.com", subject: "It's your turn!", body: "Hi Alice" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pingram.io/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer pingram_sk_test123" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      type: "transactional",
      to: "alice@example.com",
      subject: "It's your turn!",
      html: "<p>Hi Alice</p>",
      fromAddress: "noreply@q.m9rcy.dev",
    });
  });

  it("hits the region-specific host — Pingram's account data doesn't exist cross-region, even for a genuinely valid key", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ trackingId: "abc" }) });
    const euConfig: Record<string, string> = { ...config, PINGRAM_REGION: "eu" };
    const provider = new PingramEmailProvider({
      get: (key: string) => euConfig[key],
    } as ConfigService);

    await provider.send({ to: "alice@example.com", subject: "s", body: "b" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.eu.pingram.io/email", expect.anything());
  });

  it("defaults to the us region when PINGRAM_REGION is unset (matches Pingram's own SDK default)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ trackingId: "abc" }) });
    const provider = new PingramEmailProvider(configService);

    await provider.send({ to: "alice@example.com", subject: "s", body: "b" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.pingram.io/email", expect.anything());
  });

  it("throws on an unrecognized region rather than silently hitting the wrong host", async () => {
    const badRegionConfig: Record<string, string> = { ...config, PINGRAM_REGION: "au" };
    const provider = new PingramEmailProvider({
      get: (key: string) => badRegionConfig[key],
    } as ConfigService);

    await expect(provider.send({ to: "a@example.com", subject: "s", body: "b" })).rejects.toThrow(
      /PINGRAM_REGION/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escapes HTML-significant characters in the plain-text body", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const provider = new PingramEmailProvider(configService);

    await provider.send({ to: "a@example.com", subject: "s", body: "5 < 10 & 10 > 5" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toBe("<p>5 &lt; 10 &amp; 10 &gt; 5</p>");
  });

  it("throws without ever calling fetch when the API key is not configured", async () => {
    const providerWithNoKey = new PingramEmailProvider({
      get: () => undefined,
    } as unknown as ConfigService);
    await expect(
      providerWithNoKey.send({ to: "a@example.com", subject: "s", body: "b" }),
    ).rejects.toThrow(/PINGRAM_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Pingram's own error message on failure, without ever mentioning the API key", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        error: { code: "invalid_recipient", message: "to is not a valid email" },
      }),
    });
    const provider = new PingramEmailProvider(configService);

    // The acceptance criterion: secrets are never logged or surfaced, in
    // the success or failure path — only what Pingram's own response said.
    await expect(provider.send({ to: "not-an-email", subject: "s", body: "b" })).rejects.toThrow(
      "to is not a valid email",
    );
    try {
      await provider.send({ to: "not-an-email", subject: "s", body: "b" });
    } catch (err) {
      expect(String(err)).not.toContain(config.PINGRAM_API_KEY);
    }
  });
});
