import * as dbService from "../services/db";
import {
  activateSubscription,
  cancelSubscription,
  formatSubscriptionStatus,
  getSubscription,
  getSubscriptionAccess,
  getTrialDays,
  startTrialIfMissing,
} from "../services/subscription";

describe("Subscription Service", () => {
  const originalTrialDays = process.env.TRIAL_DAYS;

  afterEach(() => {
    process.env.TRIAL_DAYS = originalTrialDays;
    jest.restoreAllMocks();
  });

  it("usa teste grátis padrão de 7 dias", () => {
    delete process.env.TRIAL_DAYS;
    expect(getTrialDays()).toBe(7);
  });

  it("lê duração do teste via TRIAL_DAYS", () => {
    process.env.TRIAL_DAYS = "14";
    expect(getTrialDays()).toBe(14);
  });

  it("cria teste grátis apenas quando não existe assinatura", async () => {
    const execute = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    jest.spyOn(dbService, "getDb").mockReturnValue({ execute } as any);

    await startTrialIfMissing("chat-1", new Date("2026-05-08T12:00:00.000Z"));

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("ON CONFLICT(chat_id) DO NOTHING"),
      args: [
        "chat-1",
        "2026-05-08T12:00:00.000Z",
        "2026-05-15T12:00:00.000Z",
        "2026-05-08T12:00:00.000Z",
      ],
    }));
  });

  it("ativa assinatura manual por quantidade de dias", async () => {
    const execute = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    jest.spyOn(dbService, "getDb").mockReturnValue({ execute } as any);

    await activateSubscription("chat-1", 30, "basic", new Date("2026-05-08T12:00:00.000Z"));

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("status = 'active'"),
      args: ["chat-1", "basic", "2026-06-07T12:00:00.000Z", "manual", null, null, "2026-05-08T12:00:00.000Z"],
    }));
  });

  it("cancela assinatura manualmente", async () => {
    const execute = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    jest.spyOn(dbService, "getDb").mockReturnValue({ execute } as any);

    await cancelSubscription("chat-1", new Date("2026-05-08T12:00:00.000Z"));

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("status = 'canceled'"),
      args: ["chat-1", "2026-05-08T12:00:00.000Z"],
    }));
  });

  it("retorna null quando usuário não tem assinatura", async () => {
    jest.spyOn(dbService, "getDb").mockReturnValue({
      execute: jest.fn().mockResolvedValue({ rows: [] }),
    } as any);

    await expect(getSubscription("chat-1")).resolves.toBeNull();
  });

  it("permite acesso durante teste grátis", async () => {
    jest.spyOn(dbService, "getDb").mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        rows: [{
          chat_id: "chat-1",
          status: "trialing",
          trial_ends_at: "2026-05-15T12:00:00.000Z",
        }],
      }),
    } as any);

    await expect(getSubscriptionAccess("chat-1", new Date("2026-05-08T12:00:00.000Z"))).resolves.toEqual({
      hasAccess: true,
      status: "trialing",
      reason: "trial",
      trialEndsAt: "2026-05-15T12:00:00.000Z",
      daysLeft: 7,
    });
  });

  it("bloqueia teste grátis expirado", async () => {
    jest.spyOn(dbService, "getDb").mockReturnValue({
      execute: jest.fn().mockResolvedValue({
        rows: [{
          chat_id: "chat-1",
          status: "trialing",
          trial_ends_at: "2026-05-01T12:00:00.000Z",
        }],
      }),
    } as any);

    await expect(getSubscriptionAccess("chat-1", new Date("2026-05-08T12:00:00.000Z"))).resolves.toEqual({
      hasAccess: false,
      status: "trialing",
      reason: "expired",
      trialEndsAt: "2026-05-01T12:00:00.000Z",
    });
  });

  it("formata status de assinatura para o bot", () => {
    expect(formatSubscriptionStatus({
      hasAccess: true,
      status: "trialing",
      reason: "trial",
      daysLeft: 3,
    })).toContain("Teste grátis ativo");
  });
});
