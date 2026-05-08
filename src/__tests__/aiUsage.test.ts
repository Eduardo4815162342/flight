import * as dbService from "../services/db";
import { canAskAI, getAIDailyLimit, getAIUsageLast24h, recordAIQuery } from "../services/aiUsage";

describe("AI Usage Service", () => {
  const originalLimit = process.env.AI_DAILY_LIMIT;

  afterEach(() => {
    process.env.AI_DAILY_LIMIT = originalLimit;
    jest.restoreAllMocks();
  });

  it("usa limite padrão de 10 perguntas", () => {
    delete process.env.AI_DAILY_LIMIT;
    expect(getAIDailyLimit()).toBe(10);
  });

  it("lê limite via AI_DAILY_LIMIT", () => {
    process.env.AI_DAILY_LIMIT = "3";
    expect(getAIDailyLimit()).toBe(3);
  });

  it("consulta uso das últimas 24h", async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [{ n: 4 }] });
    jest.spyOn(dbService, "getDb").mockReturnValue({ execute } as any);

    const used = await getAIUsageLast24h("chat-1", new Date("2026-05-08T12:00:00.000Z"));

    expect(used).toBe(4);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("FROM ai_queries"),
      args: ["chat-1", "2026-05-07T12:00:00.000Z"],
    }));
  });

  it("bloqueia quando uso alcança limite", async () => {
    process.env.AI_DAILY_LIMIT = "2";
    jest.spyOn(dbService, "getDb").mockReturnValue({
      execute: jest.fn().mockResolvedValue({ rows: [{ n: 2 }] }),
    } as any);

    await expect(canAskAI("chat-1")).resolves.toEqual({
      allowed: false,
      used: 2,
      limit: 2,
    });
  });

  it("registra consulta de IA", async () => {
    const execute = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    jest.spyOn(dbService, "getDb").mockReturnValue({ execute } as any);

    await recordAIQuery("chat-1", "BSB GRU vale a pena?", true, new Date("2026-05-08T12:00:00.000Z"));

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("INSERT INTO ai_queries"),
      args: ["chat-1", "BSB GRU vale a pena?", 1, "2026-05-08T12:00:00.000Z"],
    }));
  });
});
