import { bestDayOfWeek, calcTrend, BestDayResult, TrendResult } from "../utils/priceHistory";

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
