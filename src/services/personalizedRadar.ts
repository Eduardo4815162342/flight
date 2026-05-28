import { config } from "../config";
import { HistoryEntry } from "../types";
import { calculateRouteIntelligence, RouteRecommendation } from "./intelligence";
import { formatBRL } from "./currency";
import { getDb } from "./db";
import { getFullHistory } from "./history";
import { sendMessage } from "./telegram";
import { UserAlert } from "./user";

export type PersonalizedRadarAction =
  | "price_error"
  | "buy"
  | "wait"
  | "monitor"
  | "create_alert";

export interface PersonalizedRadarItem {
  alertId?: number;
  route: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  maxPriceBRL: number;
  latestPrice: number | null;
  sampleCount: number;
  dealScore: number | null;
  recommendation: RouteRecommendation | null;
  action: PersonalizedRadarAction;
  reasons: string[];
}

export interface PersonalizedRadarReport {
  chatId: string;
  generatedAt: string;
  totalAlerts: number;
  items: PersonalizedRadarItem[];
}

export interface BuildPersonalizedRadarOptions {
  alerts: UserAlert[];
  history: HistoryEntry[];
  generatedAt?: string;
  priceErrorThreshold?: number;
}

export interface RunPersonalizedRadarResult {
  usersAnalyzed: number;
  messagesSent: number;
  itemsSent: number;
}

function todayISO(generatedAt: string): string {
  return new Date(generatedAt).toISOString().split("T")[0];
}

function isExpired(alert: UserAlert, generatedAt: string): boolean {
  return alert.departure_date < todayISO(generatedAt);
}

function sameReturnDate(alert: UserAlert, entry: HistoryEntry): boolean {
  return (alert.return_date ?? "") === (entry.returnDate ?? "");
}

function matchingHistory(alert: UserAlert, history: HistoryEntry[]): HistoryEntry[] {
  return history
    .filter((entry) =>
      entry.origin === alert.origin &&
      entry.destination === alert.destination &&
      entry.departureDate === alert.departure_date &&
      sameReturnDate(alert, entry) &&
      entry.cheapestPriceBRL !== null
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function isPossiblePriceError(
  latestPrice: number,
  average30d: number | null,
  threshold: number
): boolean {
  return average30d !== null && latestPrice <= average30d * (1 - threshold);
}

function classifyAction(
  latestPrice: number | null,
  maxPriceBRL: number,
  recommendation: RouteRecommendation | null,
  isPriceError: boolean,
  sampleCount: number
): PersonalizedRadarAction {
  if (isPriceError) return "price_error";
  if (sampleCount < 3 || latestPrice === null) return "create_alert";
  if (recommendation === "wait" || latestPrice > maxPriceBRL) return "wait";
  if (recommendation === "buy" || latestPrice <= maxPriceBRL) return "buy";
  return "monitor";
}

function baseReasons(
  action: PersonalizedRadarAction,
  intelligenceReasons: string[],
  latestPrice: number | null,
  maxPriceBRL: number
): string[] {
  const reasons = [...intelligenceReasons];
  if (action === "price_error") {
    reasons.unshift("possivel erro de tarifa");
  }
  if (action === "wait" && latestPrice !== null && latestPrice > maxPriceBRL) {
    reasons.unshift("preco acima do limite do alerta");
  }
  if (action === "create_alert") {
    reasons.unshift("dados insuficientes para decisao forte");
  }
  return reasons.slice(0, 3);
}

function actionRank(action: PersonalizedRadarAction): number {
  const ranks: Record<PersonalizedRadarAction, number> = {
    price_error: 0,
    buy: 1,
    wait: 2,
    monitor: 3,
    create_alert: 4,
  };
  return ranks[action];
}

export function buildPersonalizedRadarReports(options: BuildPersonalizedRadarOptions): PersonalizedRadarReport[] {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const priceErrorThreshold = options.priceErrorThreshold ?? config.search.priceErrorThreshold;
  const byUser = new Map<string, UserAlert[]>();

  for (const alert of options.alerts) {
    if (!alert.is_active || isExpired(alert, generatedAt)) continue;
    byUser.set(alert.chat_id, [...(byUser.get(alert.chat_id) ?? []), alert]);
  }

  const reports: PersonalizedRadarReport[] = [];

  for (const [chatId, alerts] of byUser.entries()) {
    const items = alerts.map((alert) => {
      const routeHistory = matchingHistory(alert, options.history);
      const historyPoints: [number, number][] = routeHistory.map((entry) => [
        Math.floor(new Date(entry.timestamp).getTime() / 1000),
        entry.cheapestPriceBRL as number,
      ]);
      const intelligence = calculateRouteIntelligence({
        origin: alert.origin,
        destination: alert.destination,
        history: historyPoints,
        nowMs: new Date(generatedAt).getTime(),
      });
      const latestPrice = intelligence?.latestPrice ?? null;
      const isPriceError = latestPrice !== null
        ? isPossiblePriceError(latestPrice, intelligence?.average30d ?? null, priceErrorThreshold)
        : false;
      const action = classifyAction(
        latestPrice,
        alert.max_price_brl,
        intelligence?.recommendation ?? null,
        isPriceError,
        routeHistory.length
      );

      return {
        alertId: alert.id,
        route: `${alert.origin} → ${alert.destination}`,
        origin: alert.origin,
        destination: alert.destination,
        departureDate: alert.departure_date,
        returnDate: alert.return_date,
        maxPriceBRL: alert.max_price_brl,
        latestPrice,
        sampleCount: routeHistory.length,
        dealScore: intelligence?.dealScore ?? null,
        recommendation: intelligence?.recommendation ?? null,
        action,
        reasons: baseReasons(action, intelligence?.reasons ?? [], latestPrice, alert.max_price_brl),
      };
    }).sort((a, b) => {
      const rankDiff = actionRank(a.action) - actionRank(b.action);
      if (rankDiff !== 0) return rankDiff;
      return (b.dealScore ?? 0) - (a.dealScore ?? 0);
    });

    if (items.length > 0) {
      reports.push({
        chatId,
        generatedAt,
        totalAlerts: alerts.length,
        items,
      });
    }
  }

  return reports.sort((a, b) => a.chatId.localeCompare(b.chatId));
}

function actionLabel(action: PersonalizedRadarAction): string {
  if (action === "price_error") return "Erro de tarifa provavel";
  if (action === "buy") return "Comprar agora";
  if (action === "wait") return "Esperar";
  if (action === "monitor") return "Monitorar";
  return "Criar/ajustar alerta";
}

function actionEmoji(action: PersonalizedRadarAction): string {
  if (action === "price_error") return "🚨";
  if (action === "buy") return "✅";
  if (action === "wait") return "⏳";
  if (action === "monitor") return "👀";
  return "🔔";
}

function formatDateBR(isoDate: string): string {
  return isoDate.split("-").reverse().join("/");
}

function renderItem(item: PersonalizedRadarItem): string {
  const price = item.latestPrice === null ? "sem preco recente" : formatBRL(item.latestPrice);
  const score = item.dealScore === null ? "score indisponivel" : `score ${item.dealScore}/100`;
  const reasons = item.reasons.length > 0 ? item.reasons.join("; ") : "sem motivo forte";
  const editHint = item.alertId ? `\n   Ajuste: \`/editar ${item.alertId} NOVO_PRECO\`` : "";

  return [
    `${actionEmoji(item.action)} *${actionLabel(item.action)}* — *${item.route}*`,
    `   Ida: ${formatDateBR(item.departureDate)}${item.returnDate ? ` | Volta: ${formatDateBR(item.returnDate)}` : ""}`,
    `   Atual: *${price}* | Limite: *${formatBRL(item.maxPriceBRL)}* | ${score}`,
    `   Motivos: ${reasons}${editHint}`,
  ].join("\n");
}

export function renderPersonalizedRadarMessage(report: PersonalizedRadarReport): string {
  const generated = new Date(report.generatedAt).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const items = report.items.slice(0, 8);

  return [
    "📡 *Radar inteligente personalizado*",
    `Gerado em: ${generated}`,
    "",
    `Analisei *${report.totalAlerts} alerta(s)* ativo(s).`,
    "",
    ...items.map(renderItem).flatMap((item) => [item, ""]),
    report.items.length > items.length
      ? `_Mostrando ${items.length} de ${report.items.length} oportunidade(s)._`
      : "_Use /meusalertas para gerenciar seus alertas._",
  ].join("\n").trim();
}

export async function getRadarEligibleAlerts(): Promise<UserAlert[]> {
  const result = await getDb().execute({
    sql: `SELECT a.* FROM alerts a
          JOIN users u ON a.chat_id = u.chat_id
          LEFT JOIN subscriptions s ON s.chat_id = u.chat_id
          WHERE a.is_active = 1
            AND u.is_authorized = 1
            AND (
              u.chat_id = ?
              OR s.status = 'manual'
              OR (s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND datetime(s.trial_ends_at) >= datetime('now'))
              OR (s.status = 'active' AND (s.paid_until IS NULL OR datetime(s.paid_until) >= datetime('now')))
            )`,
    args: [config.telegram.chatId],
  });

  return result.rows.map((row) => ({
    id: Number(row.id),
    chat_id: String(row.chat_id),
    origin: String(row.origin),
    destination: String(row.destination),
    departure_date: String(row.departure_date),
    return_date: row.return_date ? String(row.return_date) : undefined,
    trip_type: String(row.trip_type),
    max_price_brl: Number(row.max_price_brl),
    is_active: Boolean(row.is_active),
  }));
}

export async function runPersonalizedRadar(): Promise<RunPersonalizedRadarResult> {
  const [alerts, history] = await Promise.all([
    getRadarEligibleAlerts(),
    getFullHistory(),
  ]);
  const reports = buildPersonalizedRadarReports({
    alerts,
    history,
    priceErrorThreshold: config.search.priceErrorThreshold,
  });

  let messagesSent = 0;
  let itemsSent = 0;

  for (const report of reports) {
    await sendMessage(renderPersonalizedRadarMessage(report), report.chatId);
    messagesSent++;
    itemsSent += report.items.length;
  }

  return {
    usersAnalyzed: reports.length,
    messagesSent,
    itemsSent,
  };
}
