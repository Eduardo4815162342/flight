import { bestDayOfWeek, calcTrend, BestDayResult, TrendResult } from "../utils/priceHistory";
import { HistoryEntry } from "../types";

export type RouteRecommendation = "buy" | "monitor" | "wait";

export interface RouteIntelligenceInput {
  origin: string;
  destination: string;
  history: [number, number][];
  currentPriceBRL?: number | null;
  nowMs?: number;
}

export interface RouteIntelligence {
  route: string;
  origin: string;
  destination: string;
  sampleCount: number;
  latestPrice: number;
  lowestEver: number;
  average30d: number | null;
  min30d: number | null;
  currentVsAverage30dPct: number | null;
  currentVsLowestPct: number;
  trend7d: TrendResult | null;
  bestDay: BestDayResult | null;
  dealScore: number;
  recommendation: RouteRecommendation;
  reasons: string[];
}

export interface InsufficientDataRoute {
  route: string;
  origin: string;
  destination: string;
  departureDate: string;
  sampleCount: number;
}

export interface DailyIntelligenceItem extends RouteIntelligence {
  departureDate: string;
}

export interface DailyIntelligenceReport {
  generatedAt: string;
  totalHistoryEntries: number;
  analyzedRoutes: number;
  topOpportunities: DailyIntelligenceItem[];
  routesToWait: DailyIntelligenceItem[];
  routesToMonitor: DailyIntelligenceItem[];
  insufficientData: InsufficientDataRoute[];
  items: DailyIntelligenceItem[];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function pricesInLastDays(history: [number, number][], days: number, nowMs: number): number[] {
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  return history.filter(([ts]) => ts * 1000 >= cutoffMs).map(([, price]) => price);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculateRouteIntelligence(input: RouteIntelligenceInput): RouteIntelligence | null {
  const sorted = [...input.history].sort((a, b) => a[0] - b[0]);
  const currentPrice = input.currentPriceBRL ?? sorted[sorted.length - 1]?.[1] ?? null;
  if (currentPrice === null) return null;

  const prices = sorted.map(([, price]) => price);
  const lowestEver = Math.min(currentPrice, ...prices);
  const nowMs = input.nowMs ?? Date.now();
  const prices30d = pricesInLastDays(sorted, 30, nowMs);
  const average30d = average(prices30d);
  const min30d = prices30d.length > 0 ? Math.min(...prices30d, currentPrice) : currentPrice;
  const trend7d = calcTrend(sorted, 7, nowMs);
  const bestDay = bestDayOfWeek(sorted);
  const currentVsAverage30dPct = average30d
    ? roundPct(((currentPrice - average30d) / average30d) * 100)
    : null;
  const currentVsLowestPct = roundPct(((currentPrice - lowestEver) / lowestEver) * 100);
  const reasons: string[] = [];

  let score = 50;

  if (currentPrice <= lowestEver * 1.05) {
    score += 30;
    reasons.push("preco perto do menor historico");
  }

  if (average30d !== null) {
    if (currentPrice <= average30d * 0.95) {
      score += 20;
      reasons.push("preco abaixo da media recente");
    } else if (currentPrice >= average30d * 1.15) {
      score -= 25;
      reasons.push("preco acima da media recente");
    }
  }

  if (trend7d?.direction === "down") {
    score += 10;
    reasons.push("tendencia recente de queda");
  } else if (trend7d?.direction === "up") {
    score -= 15;
    reasons.push("tendencia recente de alta");
  }

  if (sorted.length < 3) {
    score = Math.min(score, 60);
    reasons.push("poucas amostras historicas");
  }

  const dealScore = clampScore(score);
  const recommendation: RouteRecommendation =
    sorted.length < 3 ? "monitor" : dealScore >= 80 ? "buy" : dealScore < 50 ? "wait" : "monitor";

  return {
    route: `${input.origin}→${input.destination}`,
    origin: input.origin,
    destination: input.destination,
    sampleCount: sorted.length,
    latestPrice: currentPrice,
    lowestEver,
    average30d,
    min30d,
    currentVsAverage30dPct,
    currentVsLowestPct,
    trend7d,
    bestDay,
    dealScore,
    recommendation,
    reasons,
  };
}

function routeKey(entry: HistoryEntry): string {
  return [
    entry.origin,
    entry.destination,
    entry.departureDate,
    entry.returnDate ?? "",
  ].join("|");
}

function todayISO(generatedAt: string): string {
  return new Date(generatedAt).toISOString().split("T")[0];
}

function formatBRL(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function recommendationLabel(value: RouteRecommendation): string {
  if (value === "buy") return "comprar";
  if (value === "wait") return "esperar";
  return "monitorar";
}

export function buildDailyIntelligenceReport(
  history: HistoryEntry[],
  generatedAt: string = new Date().toISOString()
): DailyIntelligenceReport {
  const grouped = new Map<string, HistoryEntry[]>();
  const today = todayISO(generatedAt);

  for (const entry of history) {
    if (entry.cheapestPriceBRL === null) continue;
    if (entry.departureDate < today) continue;
    const key = routeKey(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  const items: DailyIntelligenceItem[] = [];
  const insufficientData: InsufficientDataRoute[] = [];
  const nowMs = new Date(generatedAt).getTime();

  for (const entries of grouped.values()) {
    const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = sorted[0];
    const historyPoints: [number, number][] = sorted.map((entry) => [
      Math.floor(new Date(entry.timestamp).getTime() / 1000),
      entry.cheapestPriceBRL as number,
    ]);

    const intelligence = calculateRouteIntelligence({
      origin: first.origin,
      destination: first.destination,
      history: historyPoints,
      nowMs,
    });

    if (!intelligence || intelligence.sampleCount < 3) {
      insufficientData.push({
        route: `${first.origin}→${first.destination}`,
        origin: first.origin,
        destination: first.destination,
        departureDate: first.departureDate,
        sampleCount: historyPoints.length,
      });
      continue;
    }

    items.push({
      ...intelligence,
      departureDate: first.departureDate,
    });
  }

  const sortedItems = items.sort((a, b) => b.dealScore - a.dealScore);

  return {
    generatedAt,
    totalHistoryEntries: history.length,
    analyzedRoutes: sortedItems.length,
    topOpportunities: sortedItems.filter((item) => item.recommendation === "buy").slice(0, 10),
    routesToWait: sortedItems.filter((item) => item.recommendation === "wait").slice(0, 10),
    routesToMonitor: sortedItems.filter((item) => item.recommendation === "monitor").slice(0, 10),
    insufficientData: insufficientData.sort((a, b) => a.route.localeCompare(b.route)),
    items: sortedItems,
  };
}

function renderItems(items: DailyIntelligenceItem[]): string {
  if (items.length === 0) return "_Nenhuma rota nesta categoria._";

  return items.map((item, index) => {
    const reasons = item.reasons.length > 0 ? item.reasons.join("; ") : "sem motivo forte";
    const average = item.average30d === null ? "media indisponivel" : `media 30d ${formatBRL(item.average30d)}`;
    return [
      `${index + 1}. ${item.route} em ${item.departureDate}`,
      `   - Score: ${item.dealScore}/100; recomendacao: ${recommendationLabel(item.recommendation)}`,
      `   - Preco atual: ${formatBRL(item.latestPrice)}; menor historico: ${formatBRL(item.lowestEver)}; ${average}`,
      `   - Motivos: ${reasons}`,
    ].join("\n");
  }).join("\n\n");
}

export function renderDailyIntelligenceMarkdown(report: DailyIntelligenceReport): string {
  const generated = new Date(report.generatedAt).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const insufficient = report.insufficientData.length === 0
    ? "_Nenhuma rota com dados insuficientes._"
    : report.insufficientData.map((item) =>
      `- ${item.route} em ${item.departureDate}: ${item.sampleCount} amostra(s)`
    ).join("\n");

  return [
    "# BSB Price Track - Inteligencia diaria",
    "",
    `Gerado em: ${generated}`,
    "",
    "## Resumo",
    "",
    `- Entradas no historico: ${report.totalHistoryEntries}`,
    `- Rotas analisadas: ${report.analyzedRoutes}`,
    `- Oportunidades: ${report.topOpportunities.length}`,
    `- Rotas para esperar: ${report.routesToWait.length}`,
    `- Rotas para monitorar: ${report.routesToMonitor.length}`,
    `- Rotas com dados insuficientes: ${report.insufficientData.length}`,
    "",
    "## Top oportunidades",
    "",
    renderItems(report.topOpportunities),
    "",
    "## Esperar",
    "",
    renderItems(report.routesToWait),
    "",
    "## Monitorar",
    "",
    renderItems(report.routesToMonitor),
    "",
    "## Dados insuficientes",
    "",
    insufficient,
    "",
  ].join("\n");
}
