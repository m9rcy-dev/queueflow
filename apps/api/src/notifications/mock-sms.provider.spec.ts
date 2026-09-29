import { MockSmsProvider } from "./mock-sms.provider";

describe("MockSmsProvider", () => {
  it("records what it 'sent' for test introspection", async () => {
    const provider = new MockSmsProvider();
    await provider.send({ to: "+64211234567", body: "You're up next!" });

    expect(provider.sent).toEqual([{ to: "+64211234567", body: "You're up next!" }]);
  });

  it("never throws — a mock provider is never the reason a notification fails", async () => {
    const provider = new MockSmsProvider();
    await expect(provider.send({ to: "+64211234567", body: "hi" })).resolves.toBeUndefined();
  });
});
