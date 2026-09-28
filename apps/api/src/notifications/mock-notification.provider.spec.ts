import { MockNotificationProvider } from "./mock-notification.provider";

describe("MockNotificationProvider", () => {
  it("records what it 'sent' for test introspection", async () => {
    const provider = new MockNotificationProvider();
    await provider.send({ channel: "SMS", recipient: "+64211234567", body: "You're up next!" });

    expect(provider.sent).toEqual([
      { channel: "SMS", recipient: "+64211234567", body: "You're up next!" },
    ]);
  });

  it("never throws — a mock provider is never the reason a notification fails", async () => {
    const provider = new MockNotificationProvider();
    await expect(
      provider.send({ channel: "EMAIL", recipient: "a@example.com", body: "hi" }),
    ).resolves.toBeUndefined();
  });
});
