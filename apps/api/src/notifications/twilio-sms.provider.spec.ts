import type { ConfigService } from "@nestjs/config";
import { TwilioSmsProvider } from "./twilio-sms.provider";

describe("TwilioSmsProvider (Phase 20)", () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const provider = (values: Record<string, string>) =>
    new TwilioSmsProvider({ get: (key: string) => values[key] } as unknown as ConfigService);
  const creds = { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret-token" };

  it("posts to Twilio's Messages API with basic auth, preferring a Messaging Service", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await provider({
      ...creds,
      TWILIO_MESSAGING_SERVICE_SID: "MG456",
      TWILIO_FROM_NUMBER: "+15550001111",
    }).send({ to: "+64211234567", body: "It's your turn" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("AC123:secret-token").toString("base64")}`,
    );
    const form = new URLSearchParams(init.body);
    expect(form.get("To")).toBe("+64211234567");
    expect(form.get("Body")).toBe("It's your turn");
    expect(form.get("MessagingServiceSid")).toBe("MG456");
    expect(form.get("From")).toBeNull();
  });

  it("uses a From number when there's no Messaging Service", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await provider({ ...creds, TWILIO_FROM_NUMBER: "+15550001111" }).send({
      to: "+64211234567",
      body: "x",
    });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("From")).toBe("+15550001111");
  });

  it("fails clearly when not configured, and on Twilio errors — without leaking the token", async () => {
    await expect(provider(creds).send({ to: "+64211234567", body: "x" })).rejects.toThrow(
      /TWILIO_MESSAGING_SERVICE_SID/,
    );
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ code: 21211, message: "Invalid 'To' Phone Number" }),
    });
    const sending = provider({ ...creds, TWILIO_FROM_NUMBER: "+1555" }).send({
      to: "bad",
      body: "x",
    });
    await expect(sending).rejects.toThrow("Invalid 'To' Phone Number");
    await expect(sending).rejects.not.toThrow(/secret-token/);
  });
});
