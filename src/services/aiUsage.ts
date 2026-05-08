import { getDb } from "./db";

export interface AIUsageStatus {
  allowed: boolean;
  used: number;
  limit: number;
}

export function getAIDailyLimit(): number {
  const parsed = Number(process.env.AI_DAILY_LIMIT ?? "10");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 10;
}

export async function getAIUsageLast24h(chatId: string, now: Date = new Date()): Promise<number> {
  const db = getDb();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const result = await db.execute({
    sql: `SELECT COUNT(*) as n FROM ai_queries
          WHERE chat_id = ? AND created_at >= ?`,
    args: [chatId, since],
  });

  return Number(result.rows[0]?.n ?? 0);
}

export async function canAskAI(chatId: string, now: Date = new Date()): Promise<AIUsageStatus> {
  const limit = getAIDailyLimit();
  const used = await getAIUsageLast24h(chatId, now);
  return { allowed: used < limit, used, limit };
}

export async function recordAIQuery(
  chatId: string,
  question: string,
  success: boolean,
  createdAt: Date = new Date()
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO ai_queries (chat_id, question, success, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [chatId, question, success ? 1 : 0, createdAt.toISOString()],
  });
}
