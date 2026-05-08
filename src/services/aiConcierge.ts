import { getRouteLowestPrice, getRoutePriceHistory } from "./history";
import { completeChat } from "./openrouter";
import { formatBRL } from "./currency";
import { bestDayOfWeek, calcTrend, TrendResult, BestDayResult } from "../utils/priceHistory";

interface Route {
  origin: string;
  destination: string;
}

interface RouteStats {
  route: Route;
  sampleCount: number;
  latestPrice: number;
  lowestEver: number | null;
  average30d: number | null;
  min30d: number | null;
  currentVsAverage30dPct: number | null;
  currentVsLowestPct: number | null;
  trend7d: TrendResult | null;
  bestDay: BestDayResult | null;
}

const ROUTE_STOP_WORDS = new Set([
  "QUE", "PRA", "PAR", "COM", "UMA", "POR", "DIA", "HOJ", "CAR", "AGR",
]);

export function extractRouteFromQuestion(question: string): Route | null {
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const explicit = normalized.match(/\b([A-Z]{3})\s*(?:→|->|>|-|–|—|PARA|PRA|A)\s*([A-Z]{3})\b/);
  if (explicit && explicit[1] !== explicit[2]) {
    return { origin: explicit[1], destination: explicit[2] };
  }

  const codes = (normalized.match(/\b[A-Z]{3}\b/g) ?? [])
    .filter((code) => !ROUTE_STOP_WORDS.has(code));

  if (codes.length < 2) return null;

  const [origin, destination] = codes;
  if (origin === destination) return null;

  return { origin, destination };
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function pricesInLastDays(
  history: [number, number][],
  days: number,
  nowMs: number
): number[] {
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  return history
    .filter(([ts]) => ts * 1000 >= cutoffMs)
    .map(([, price]) => price);
}

async function buildRouteStats(route: Route, nowMs = Date.now()): Promise<RouteStats | null> {
  const history = await getRoutePriceHistory(route.origin, route.destination);
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => a[0] - b[0]);
  const latestPrice = sorted[sorted.length - 1][1];
  const lowestEver = await getRouteLowestPrice(route.origin, route.destination);
  const prices30d = pricesInLastDays(sorted, 30, nowMs);
  const average30d = average(prices30d);
  const min30d = prices30d.length > 0 ? Math.min(...prices30d) : null;
  const trend7d = calcTrend(sorted, 7, nowMs);
  const bestDay = bestDayOfWeek(sorted);

  return {
    route,
    sampleCount: sorted.length,
    latestPrice,
    lowestEver,
    average30d,
    min30d,
    currentVsAverage30dPct: average30d ? roundPct(((latestPrice - average30d) / average30d) * 100) : null,
    currentVsLowestPct: lowestEver ? roundPct(((latestPrice - lowestEver) / lowestEver) * 100) : null,
    trend7d,
    bestDay,
  };
}

function describeTrend(trend: TrendResult | null): string {
  if (!trend) return "sem dados suficientes nos últimos 7 dias";
  if (trend.direction === "down") return `queda de ${Math.abs(trend.pct)}% nos últimos 7 dias`;
  if (trend.direction === "up") return `alta de ${trend.pct}% nos últimos 7 dias`;
  return `estável nos últimos 7 dias (${trend.pct}%)`;
}

function formatOptionalMoney(value: number | null): string {
  return value === null ? "indisponível" : formatBRL(value);
}

function formatOptionalPct(value: number | null): string {
  if (value === null) return "indisponível";
  return `${value > 0 ? "+" : ""}${value}%`;
}

export function buildConciergePrompt(question: string, stats: RouteStats): string {
  const route = `${stats.route.origin} → ${stats.route.destination}`;
  return [
    `Pergunta do usuário: ${question}`,
    "",
    "Contexto real do banco do BSB Price Track:",
    `Rota: ${route}`,
    `Registros históricos: ${stats.sampleCount}`,
    `Último preço registrado: ${formatBRL(stats.latestPrice)}`,
    `Menor preço histórico: ${formatOptionalMoney(stats.lowestEver)}`,
    `Média dos últimos 30 dias: ${formatOptionalMoney(stats.average30d)}`,
    `Menor preço dos últimos 30 dias: ${formatOptionalMoney(stats.min30d)}`,
    `Preço atual vs média 30d: ${formatOptionalPct(stats.currentVsAverage30dPct)}`,
    `Preço atual vs menor histórico: ${formatOptionalPct(stats.currentVsLowestPct)}`,
    `Tendência 7 dias: ${describeTrend(stats.trend7d)}`,
    `Melhor dia histórico: ${stats.bestDay ? `${stats.bestDay.dayName}, média ${formatBRL(stats.bestDay.avgPrice)}` : "indisponível"}`,
    "",
    "Responda em português do Brasil, em no máximo 8 linhas.",
    "Seja prático e honesto. Não invente dados.",
    "Dê uma recomendação explícita: comprar agora, esperar, ou criar alerta.",
    "Se os dados forem insuficientes para uma decisão forte, diga isso claramente.",
  ].join("\n");
}

function fallbackAnswer(question: string, stats: RouteStats): string {
  const route = `${stats.route.origin} → ${stats.route.destination}`;
  const lines = [
    `🤖 *Minha leitura para ${route}:*`,
    "",
    `Último preço registrado: *${formatBRL(stats.latestPrice)}*`,
    `Menor histórico: *${formatOptionalMoney(stats.lowestEver)}*`,
    `Média 30d: *${formatOptionalMoney(stats.average30d)}*`,
    `Tendência: ${describeTrend(stats.trend7d)}`,
    "",
  ];

  if (stats.currentVsAverage30dPct !== null && stats.currentVsAverage30dPct <= -5) {
    lines.push("Recomendação: *comprar agora* se a data fizer sentido. O preço está abaixo da média recente.");
  } else if (stats.currentVsLowestPct !== null && stats.currentVsLowestPct > 20) {
    lines.push("Recomendação: *esperar ou criar alerta*. O preço atual está bem acima do menor histórico registrado.");
  } else {
    lines.push("Recomendação: *criar alerta* e monitorar. Os dados não mostram uma oportunidade muito forte agora.");
  }

  lines.push("", `_Pergunta analisada: ${question}_`);
  return lines.join("\n");
}

export async function answerTravelQuestion(question: string): Promise<string> {
  const route = extractRouteFromQuestion(question);
  if (!route) {
    return "❌ Não consegui identificar a rota.\n\nTente assim:\n`/perguntar BSB GRU vale a pena comprar agora?`";
  }

  const stats = await buildRouteStats(route);
  if (!stats) {
    return `📊 Ainda não tenho dados suficientes para *${route.origin} → ${route.destination}*.\n\nPreciso de pelo menos 2 registros no histórico para responder com contexto real. Você pode criar um alerta para essa rota e perguntar de novo depois.`;
  }

  const prompt = buildConciergePrompt(question, stats);
  const aiAnswer = await completeChat(
    [
      {
        role: "system",
        content: "Você é o concierge de viagens do BSB Price Track. Você ajuda usuários a decidir se compram passagem agora usando apenas os dados fornecidos.",
      },
      { role: "user", content: prompt },
    ],
    { maxTokens: 420, temperature: 0.2 }
  );

  return aiAnswer ?? fallbackAnswer(question, stats);
}
