import { handleCaktoWebhook, extractCaktoEvent, extractTelegramChatId } from "../services/caktoWebhook";
import * as subscription from "../services/subscription";
import * as webhook from "../services/webhook";

jest.mock("../config", () => ({
  config: {
    telegram: { botToken: "test-token", chatId: "123456789" },
    search: { origin: "BSB" },
  },
}));

jest.mock("../services/subscription", () => ({
  activateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
}));

jest.mock("../services/webhook", () => ({
  sendReply: jest.fn(),
}));

describe("Cakto Webhook", () => {
  const originalSecret = process.env.CAKTO_WEBHOOK_SECRET;
  const originalDays = process.env.CAKTO_ACCESS_DAYS;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CAKTO_WEBHOOK_SECRET;
    delete process.env.CAKTO_ACCESS_DAYS;
    (subscription.activateSubscription as jest.Mock).mockResolvedValue(undefined);
    (subscription.cancelSubscription as jest.Mock).mockResolvedValue(undefined);
    (webhook.sendReply as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.CAKTO_WEBHOOK_SECRET = originalSecret;
    process.env.CAKTO_ACCESS_DAYS = originalDays;
  });

  it("extrai evento e Telegram ID de formatos comuns", () => {
    const payload = {
      event: "purchase_approved",
      customer: { telegram_id: "987654321" },
    };

    expect(extractCaktoEvent(payload)).toBe("purchase_approved");
    expect(extractTelegramChatId(payload)).toBe("987654321");
  });

  it("ativa assinatura em compra aprovada", async () => {
    const result = await handleCaktoWebhook(JSON.stringify({
      event: "purchase_approved",
      customer: { telegram_id: "987654321", id: "cus_1" },
      subscription: { id: "sub_1" },
      product_name: "Bot Milhas",
      access_days: 30,
    }));

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      statusCode: 200,
      action: "activate",
      chatId: "987654321",
    }));
    expect(subscription.activateSubscription).toHaveBeenCalledWith("987654321", 30, expect.objectContaining({
      provider: "cakto",
      plan: "Bot Milhas",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
    }));
    expect(webhook.sendReply).toHaveBeenCalledWith("987654321", expect.stringContaining("Pagamento confirmado"));
  });

  it("usa CAKTO_ACCESS_DAYS quando payload não informa dias", async () => {
    process.env.CAKTO_ACCESS_DAYS = "31";

    await handleCaktoWebhook(JSON.stringify({
      event: "subscription_renewed",
      data: { customer: { telegramId: "987654321" } },
    }));

    expect(subscription.activateSubscription).toHaveBeenCalledWith("987654321", 31, expect.any(Object));
  });

  it("cancela assinatura em eventos negativos", async () => {
    const result = await handleCaktoWebhook(JSON.stringify({
      event: "refund",
      customer: { telegram_id: "987654321" },
    }));

    expect(result).toEqual(expect.objectContaining({ ok: true, action: "cancel" }));
    expect(subscription.cancelSubscription).toHaveBeenCalledWith("987654321");
  });

  it("ignora eventos que não mudam assinatura", async () => {
    const result = await handleCaktoWebhook(JSON.stringify({
      event: "pix_gerado",
      customer: { telegram_id: "987654321" },
    }));

    expect(result).toEqual(expect.objectContaining({ ok: true, message: "ignored" }));
    expect(subscription.activateSubscription).not.toHaveBeenCalled();
    expect(subscription.cancelSubscription).not.toHaveBeenCalled();
  });

  it("bloqueia segredo inválido quando CAKTO_WEBHOOK_SECRET está configurado", async () => {
    process.env.CAKTO_WEBHOOK_SECRET = "secret-1";

    const result = await handleCaktoWebhook(
      JSON.stringify({ event: "purchase_approved", customer: { telegram_id: "987654321" } }),
      { "x-cakto-secret": "wrong" }
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, statusCode: 401 }));
    expect(subscription.activateSubscription).not.toHaveBeenCalled();
  });

  it("aceita segredo por query string", async () => {
    process.env.CAKTO_WEBHOOK_SECRET = "secret-1";

    const result = await handleCaktoWebhook(
      JSON.stringify({ event: "purchase_approved", customer: { telegram_id: "987654321" } }),
      {},
      "/webhooks/cakto?secret=secret-1"
    );

    expect(result.ok).toBe(true);
    expect(subscription.activateSubscription).toHaveBeenCalled();
  });

  it("avisa admin quando falta Telegram ID", async () => {
    const result = await handleCaktoWebhook(JSON.stringify({ event: "purchase_approved" }));

    expect(result).toEqual(expect.objectContaining({ ok: false, statusCode: 422 }));
    expect(webhook.sendReply).toHaveBeenCalledWith("123456789", expect.stringContaining("sem Telegram ID"));
  });
});
