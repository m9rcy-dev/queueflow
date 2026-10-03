import { Test } from "@nestjs/testing";
import { EmailProviderMailService } from "./email-provider-mail.service";
import { EmailProvider } from "../notifications/email-provider";

describe("EmailProviderMailService", () => {
  let service: EmailProviderMailService;
  let emailProvider: { send: jest.Mock };

  beforeEach(async () => {
    emailProvider = { send: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [EmailProviderMailService, { provide: EmailProvider, useValue: emailProvider }],
    }).compile();
    service = module.get(EmailProviderMailService);
  });

  it("sendLoginCode sends the code through EmailProvider", async () => {
    await service.sendLoginCode("joe@example.com", "123456");
    expect(emailProvider.send).toHaveBeenCalledWith({
      to: "joe@example.com",
      subject: expect.any(String),
      body: expect.stringContaining("123456"),
    });
  });

  it("sendInviteLink sends the invite token through EmailProvider", async () => {
    await service.sendInviteLink("joe@example.com", "Joe's Barbers", "invite-token-abc");
    expect(emailProvider.send).toHaveBeenCalledWith({
      to: "joe@example.com",
      subject: expect.stringContaining("Joe's Barbers"),
      body: expect.stringContaining("invite-token-abc"),
    });
  });

  it("sendInviteCode sends the code through EmailProvider", async () => {
    await service.sendInviteCode("joe@example.com", "654321", "Joe's Barbers");
    expect(emailProvider.send).toHaveBeenCalledWith({
      to: "joe@example.com",
      subject: expect.stringContaining("Joe's Barbers"),
      body: expect.stringContaining("654321"),
    });
  });
});
