import { MockEmailProvider } from "./mock-email.provider";

describe("MockEmailProvider", () => {
  it("records what it 'sent' for test introspection", async () => {
    const provider = new MockEmailProvider();
    await provider.send({ to: "alice@example.com", subject: "It's your turn!", body: "hi" });

    expect(provider.sent).toEqual([
      { to: "alice@example.com", subject: "It's your turn!", body: "hi" },
    ]);
  });

  it("never throws — a mock provider is never the reason a notification fails", async () => {
    const provider = new MockEmailProvider();
    await expect(
      provider.send({ to: "alice@example.com", subject: "subject", body: "hi" }),
    ).resolves.toBeUndefined();
  });
});
