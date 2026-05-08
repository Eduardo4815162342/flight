import { getDb } from "./db";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "manual";

export interface SubscriptionRecord {
  chat_id: string;
  status: SubscriptionStatus;
  plan?: string;
  trial_started_at?: string;
  trial_ends_at?: string;
  paid_until?: string;
  provider?: string;
  provider_customer_id?: string;
  provider_subscription_id?: string;
  updated_at?: string;
}

export interface SubscriptionAccess {
  hasAccess: boolean;
  status: SubscriptionStatus | "none";
  reason: "trial" | "paid" | "manual" | "missing" | "expired" | "canceled" | "past_due";
  trialEndsAt?: string;
  paidUntil?: string;
  daysLeft?: number;
}

export interface ActivateSubscriptionOptions {
  plan?: string;
  provider?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getTrialDays(): number {
  const parsed = Number(process.env.TRIAL_DAYS ?? "7");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 7;
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

function daysUntil(dateIso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(dateIso).getTime() - now.getTime()) / MS_PER_DAY));
}

function rowToSubscription(row: Record<string, unknown>): SubscriptionRecord {
  return {
    chat_id: String(row.chat_id),
    status: String(row.status ?? "trialing") as SubscriptionStatus,
    plan: row.plan ? String(row.plan) : undefined,
    trial_started_at: row.trial_started_at ? String(row.trial_started_at) : undefined,
    trial_ends_at: row.trial_ends_at ? String(row.trial_ends_at) : undefined,
    paid_until: row.paid_until ? String(row.paid_until) : undefined,
    provider: row.provider ? String(row.provider) : undefined,
    provider_customer_id: row.provider_customer_id ? String(row.provider_customer_id) : undefined,
    provider_subscription_id: row.provider_subscription_id ? String(row.provider_subscription_id) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function getSubscription(chatId: string): Promise<SubscriptionRecord | null> {
  const result = await getDb().execute({
    sql: "SELECT * FROM subscriptions WHERE chat_id = ?",
    args: [chatId],
  });
  const row = result.rows[0];
  return row ? rowToSubscription(row as Record<string, unknown>) : null;
}

export async function startTrialIfMissing(chatId: string, now = new Date()): Promise<void> {
  const trialEndsAt = addDays(now, getTrialDays()).toISOString();
  await getDb().execute({
    sql: `INSERT INTO subscriptions
          (chat_id, status, plan, trial_started_at, trial_ends_at, updated_at)
          VALUES (?, 'trialing', 'basic', ?, ?, ?)
          ON CONFLICT(chat_id) DO NOTHING`,
    args: [chatId, now.toISOString(), trialEndsAt, now.toISOString()],
  });
}

export async function activateSubscription(
  chatId: string,
  days = 30,
  planOrOptions: string | ActivateSubscriptionOptions = "basic",
  now = new Date()
): Promise<void> {
  const options = typeof planOrOptions === "string" ? { plan: planOrOptions } : planOrOptions;
  const plan = options.plan ?? "basic";
  const provider = options.provider ?? "manual";
  const paidUntil = addDays(now, Math.max(1, Math.floor(days))).toISOString();
  await getDb().execute({
    sql: `INSERT INTO subscriptions
          (chat_id, status, plan, paid_until, provider, provider_customer_id, provider_subscription_id, updated_at)
          VALUES (?, 'active', ?, ?, ?, ?, ?, ?)
          ON CONFLICT(chat_id) DO UPDATE SET
            status = 'active',
            plan = excluded.plan,
            paid_until = excluded.paid_until,
            provider = excluded.provider,
            provider_customer_id = excluded.provider_customer_id,
            provider_subscription_id = excluded.provider_subscription_id,
            updated_at = excluded.updated_at`,
    args: [
      chatId,
      plan,
      paidUntil,
      provider,
      options.providerCustomerId ?? null,
      options.providerSubscriptionId ?? null,
      now.toISOString(),
    ],
  });
}

export async function cancelSubscription(chatId: string, now = new Date()): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO subscriptions
          (chat_id, status, provider, updated_at)
          VALUES (?, 'canceled', 'manual', ?)
          ON CONFLICT(chat_id) DO UPDATE SET
            status = 'canceled',
            updated_at = excluded.updated_at`,
    args: [chatId, now.toISOString()],
  });
}

export async function getSubscriptionAccess(chatId: string, now = new Date()): Promise<SubscriptionAccess> {
  const sub = await getSubscription(chatId);
  if (!sub) {
    return { hasAccess: false, status: "none", reason: "missing" };
  }

  if (sub.status === "manual") {
    return { hasAccess: true, status: sub.status, reason: "manual" };
  }

  if (sub.status === "canceled") {
    return { hasAccess: false, status: sub.status, reason: "canceled" };
  }

  if (sub.status === "past_due") {
    return { hasAccess: false, status: sub.status, reason: "past_due" };
  }

  if (sub.status === "active") {
    if (!sub.paid_until || new Date(sub.paid_until).getTime() >= now.getTime()) {
      return {
        hasAccess: true,
        status: sub.status,
        reason: "paid",
        paidUntil: sub.paid_until,
        daysLeft: sub.paid_until ? daysUntil(sub.paid_until, now) : undefined,
      };
    }
    return { hasAccess: false, status: sub.status, reason: "expired", paidUntil: sub.paid_until };
  }

  if (sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() >= now.getTime()) {
    return {
      hasAccess: true,
      status: sub.status,
      reason: "trial",
      trialEndsAt: sub.trial_ends_at,
      daysLeft: daysUntil(sub.trial_ends_at, now),
    };
  }

  return { hasAccess: false, status: sub.status, reason: "expired", trialEndsAt: sub.trial_ends_at };
}

export function formatSubscriptionStatus(access: SubscriptionAccess): string {
  if (access.reason === "trial") {
    return `🧪 *Teste grátis ativo*\nVocê ainda tem *${access.daysLeft ?? 0} dia(s)* de acesso.`;
  }
  if (access.reason === "paid") {
    return access.paidUntil
      ? `✅ *Assinatura ativa*\nSeu acesso pago vai até *${access.paidUntil.slice(0, 10)}*.`
      : "✅ *Assinatura ativa*";
  }
  if (access.reason === "manual") {
    return "✅ *Acesso manual ativo*";
  }
  if (access.reason === "missing") {
    return "⚠️ Você ainda não iniciou seu teste grátis.";
  }
  if (access.reason === "canceled") {
    return "🚫 Sua assinatura está cancelada.";
  }
  if (access.reason === "past_due") {
    return "⚠️ Sua assinatura está com pagamento pendente.";
  }
  return "⏳ Seu acesso expirou.";
}
