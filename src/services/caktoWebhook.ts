import { IncomingHttpHeaders } from "http";
import { activateSubscription, cancelSubscription } from "./subscription";
import { sendReply } from "./webhook";
import { config } from "../config";

type CaktoAction = "activate" | "cancel" | "ignore";

export interface CaktoWebhookResult {
  ok: boolean;
  statusCode: number;
  message: string;
  event?: string;
  chatId?: string;
  action?: CaktoAction;
}

const ACTIVATION_EVENTS = new Set([
  "purchase_approved",
  "subscription_created",
  "subscription_renewed",
]);

const CANCELLATION_EVENTS = new Set([
  "subscription_canceled",
  "subscription_renewal_refused",
  "refund",
  "chargeback",
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function nestedObjects(payload: Record<string, unknown>): Array<Record<string, unknown> | null> {
  return [
    payload,
    asObject(payload.data),
    asObject(payload.customer),
    asObject(payload.client),
    asObject(payload.buyer),
    asObject(payload.subscription),
    asObject(payload.purchase),
    asObject(payload.payment),
    asObject(asObject(payload.data)?.customer),
    asObject(asObject(payload.data)?.client),
    asObject(asObject(payload.data)?.buyer),
    asObject(asObject(payload.data)?.subscription),
    asObject(asObject(payload.data)?.purchase),
    asObject(asObject(payload.data)?.payment),
  ];
}

export function extractCaktoEvent(payload: Record<string, unknown>): string | null {
  for (const obj of nestedObjects(payload)) {
    const event = pickString(obj, ["event", "event_name", "eventName", "custom_id", "customId", "status"]);
    if (event) return event.toLowerCase();
  }
  return null;
}

export function extractTelegramChatId(payload: Record<string, unknown>): string | null {
  for (const obj of nestedObjects(payload)) {
    const chatId = pickString(obj, [
      "telegram_id",
      "telegramId",
      "telegram_chat_id",
      "telegramChatId",
      "chat_id",
      "chatId",
      "custom_id",
      "customId",
      "external_id",
      "externalId",
    ]);
    if (chatId && /^-?\d{5,}$/.test(chatId)) return chatId;
  }

  const metadata = asObject(payload.metadata) ?? asObject(asObject(payload.data)?.metadata);
  const metadataChatId = pickString(metadata, ["telegram_id", "telegramId", "telegram_chat_id", "chat_id", "chatId"]);
  return metadataChatId && /^-?\d{5,}$/.test(metadataChatId) ? metadataChatId : null;
}

function extractProviderId(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const obj of nestedObjects(payload)) {
    const id = pickString(obj, keys);
    if (id) return id;
  }
  return null;
}

function extractCustomerId(payload: Record<string, unknown>): string | null {
  const data = asObject(payload.data);
  return pickString(asObject(payload.customer), ["customer_id", "customerId", "client_id", "clientId", "id"])
    ?? pickString(asObject(payload.client), ["customer_id", "customerId", "client_id", "clientId", "id"])
    ?? pickString(asObject(payload.buyer), ["customer_id", "customerId", "client_id", "clientId", "id"])
    ?? pickString(asObject(data?.customer), ["customer_id", "customerId", "client_id", "clientId", "id"])
    ?? pickString(asObject(data?.client), ["customer_id", "customerId", "client_id", "clientId", "id"])
    ?? pickString(asObject(data?.buyer), ["customer_id", "customerId", "client_id", "clientId", "id"])
    ?? extractProviderId(payload, ["customer_id", "customerId", "client_id", "clientId"]);
}

function extractSubscriptionId(payload: Record<string, unknown>): string | null {
  const data = asObject(payload.data);
  return pickString(asObject(payload.subscription), ["subscription_id", "subscriptionId", "id"])
    ?? pickString(asObject(data?.subscription), ["subscription_id", "subscriptionId", "id"])
    ?? extractProviderId(payload, ["subscription_id", "subscriptionId"]);
}

function extractAccessDays(payload: Record<string, unknown>): number {
  const raw = extractProviderId(payload, ["access_days", "accessDays", "days", "duration_days", "durationDays"]);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Number(process.env.CAKTO_ACCESS_DAYS ?? "30");
}

function expectedSecret(): string | null {
  return process.env.CAKTO_WEBHOOK_SECRET?.trim() || null;
}

function providedSecret(headers: IncomingHttpHeaders, url: URL, payload: Record<string, unknown>): string | null {
  const auth = headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();

  const headerSecret = headers["x-cakto-secret"] ?? headers["x-webhook-secret"] ?? headers["x-cakto-token"];
  if (typeof headerSecret === "string") return headerSecret.trim();

  return url.searchParams.get("secret") ?? pickString(payload, ["secret", "webhook_secret", "webhookSecret"]);
}

function isAuthorized(headers: IncomingHttpHeaders, url: URL, payload: Record<string, unknown>): boolean {
  const secret = expectedSecret();
  if (!secret) return true;
  return providedSecret(headers, url, payload) === secret;
}

function actionForEvent(event: string | null): CaktoAction {
  if (!event) return "ignore";
  if (ACTIVATION_EVENTS.has(event)) return "activate";
  if (CANCELLATION_EVENTS.has(event)) return "cancel";
  return "ignore";
}

export async function handleCaktoWebhook(
  rawBody: string,
  headers: IncomingHttpHeaders = {},
  requestUrl = "/webhooks/cakto"
): Promise<CaktoWebhookResult> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, statusCode: 400, message: "invalid_json" };
  }

  const url = new URL(requestUrl, "http://localhost");
  if (!isAuthorized(headers, url, payload)) {
    return { ok: false, statusCode: 401, message: "invalid_secret" };
  }

  const event = extractCaktoEvent(payload);
  const action = actionForEvent(event);
  if (action === "ignore") {
    return { ok: true, statusCode: 200, message: "ignored", event: event ?? undefined, action };
  }

  const chatId = extractTelegramChatId(payload);
  if (!chatId) {
    await sendReply(
      config.telegram.chatId,
      `⚠️ Webhook Cakto recebido sem Telegram ID.\nEvento: \`${event ?? "desconhecido"}\``
    );
    return { ok: false, statusCode: 422, message: "missing_telegram_id", event: event ?? undefined, action };
  }

  if (action === "activate") {
    const days = extractAccessDays(payload);
    await activateSubscription(chatId, days, {
      provider: "cakto",
      plan: extractProviderId(payload, ["plan", "plan_name", "planName", "product_name", "productName"]) ?? "basic",
      providerCustomerId: extractCustomerId(payload) ?? undefined,
      providerSubscriptionId: extractSubscriptionId(payload) ?? undefined,
    });
    await sendReply(chatId, `✅ Pagamento confirmado! Sua assinatura foi ativada por *${days} dia(s)*.`);
  } else {
    await cancelSubscription(chatId);
    await sendReply(chatId, "🚫 Recebemos uma atualização da Cakto e sua assinatura foi pausada.");
  }

  return { ok: true, statusCode: 200, message: "processed", event: event ?? undefined, chatId, action };
}
