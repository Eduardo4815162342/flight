import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { Flight, SearchParams } from "../types";
import { appendHistory, getRouteLowestPrice, getRoutePriceHistory } from "./history";
import { completeChat } from "./openrouter";
import { formatBRL, getUSDtoBRL } from "./currency";
import { bestDayOfWeek, calcTrend, TrendResult, BestDayResult } from "../utils/priceHistory";
import { getCached, setCached } from "../utils/liveSearchCache";

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

export interface LiveSearchResult {
  searchDate: string;
  usedDefaultDate: boolean;
  totalFound: number;
  bestFlight: Flight;
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

function parseQuestionDate(question: string): string | null {
  const brMatch = question.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (brMatch) {
    return validateISODate(`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`);
  }

  const isoMatch = question.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return isoMatch ? validateISODate(isoMatch[0]) : null;
}

function validateISODate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

function defaultSearchDate(nowMs = Date.now()): string {
  const date = new Date(nowMs);
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().split("T")[0];
}

async function fetchLiveRoutePrice(
  route: Route,
  question: string,
  parsedDate?: string | null
): Promise<LiveSearchResult | null> {
  const searchDate = parsedDate ?? defaultSearchDate();
  const usedDefaultDate = parsedDate == null;

  const cached = getCached(route.origin, route.destination, searchDate);
  if (cached) {
    console.log(`[aiConcierge] Cache hit para ${route.origin}→${route.destination} ${searchDate}`);
    return cached;
  }

  const params: SearchParams = {
    origin: route.origin,
    destination: route.destination,
    departureDate: searchDate,
    tripType: "one-way",
    ignoreMaxPrice: true,
  };

  let flights: Flight[];
  try {
    flights = await searchWithApify(params);
  } catch {
    try {
      flights = await searchWithRapidAPI(params);
    } catch {
      return null;
    }
  }

  if (flights.length === 0) return null;

  const sorted = [...flights].sort((a, b) => a.priceBRL - b.priceBRL);
  const bestFlight = sorted[0];

  await appendHistory({
    timestamp: new Date().toISOString(),
    origin: route.origin,
    destination: route.destination,
    departureDate: searchDate,
    returnDate: undefined,
    totalFound: flights.length,
    cheapestPriceBRL: bestFlight.priceBRL,
    flights: sorted.slice(0, 10).map((flight) => ({
      airline: flight.airline,
      priceBRL: flight.priceBRL,
      departureTime: flight.departureTime,
      link: flight.link,
      source: flight.source,
    })),
  });

  const result: LiveSearchResult = { searchDate, usedDefaultDate, totalFound: flights.length, bestFlight };
  setCached(route.origin, route.destination, searchDate, result);
  return result;
}

async function buildRouteStats(route: Route, departureDate?: string, nowMs = Date.now()): Promise<RouteStats | null> {
  const history = await getRoutePriceHistory(route.origin, route.destination, departureDate);
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => a[0] - b[0]);
  const latestPrice = sorted[sorted.length - 1][1];
  const lowestEver = await getRouteLowestPrice(route.origin, route.destination, departureDate);
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

async function describeLiveInsights(live: LiveSearchResult | null): Promise<string[]> {
  if (!live) return ["Busca ao vivo: indisponível ou sem resultados"];

  const flight = live.bestFlight;
  const lines = [
    `Busca ao vivo para ${live.searchDate}: ${live.totalFound} voo(s) encontrado(s)`,
    `Data da busca foi assumida automaticamente: ${live.usedDefaultDate ? "sim" : "não"}`,
    `Menor preço ao vivo: ${formatBRL(flight.priceBRL)}`,
    `Fonte ao vivo: ${flight.source}`,
    `Companhia do menor preço: ${flight.airline ?? "indisponível"}`,
    `Escalas: ${flight.stops ?? "indisponível"}`,
  ];

  if (flight.priceInsights) {
    lines.push(`Nível de preço Google Flights: ${flight.priceInsights.priceLevel}`);
    const usdToBRL = await getUSDtoBRL();
    lines.push(`Menor preço histórico do Google Flights: ${formatBRL(flight.priceInsights.lowestPrice * usdToBRL)}`);
    lines.push(`Faixa típica Google Flights: ${formatBRL(flight.priceInsights.typicalPriceRange[0] * usdToBRL)} a ${formatBRL(flight.priceInsights.typicalPriceRange[1] * usdToBRL)}`);
  }

  return lines;
}

export async function buildConciergePrompt(
  question: string,
  route: Route,
  stats: RouteStats | null,
  live: LiveSearchResult | null
): Promise<string> {
  const routeLabel = `${route.origin} → ${route.destination}`;
  const lines = [
    `Pergunta do usuário: ${question}`,
    "",
    "Contexto real do banco do BSB Price Track:",
    `Rota: ${routeLabel}`,
  ];

  if (stats) {
    lines.push(
      `Registros históricos: ${stats.sampleCount}`,
      `Último preço registrado: ${formatBRL(stats.latestPrice)}`,
      `Menor preço histórico: ${formatOptionalMoney(stats.lowestEver)}`,
      `Média dos últimos 30 dias: ${formatOptionalMoney(stats.average30d)}`,
      `Menor preço dos últimos 30 dias: ${formatOptionalMoney(stats.min30d)}`,
      `Preço atual vs média 30d: ${formatOptionalPct(stats.currentVsAverage30dPct)}`,
      `Preço atual vs menor histórico: ${formatOptionalPct(stats.currentVsLowestPct)}`,
      `Tendência 7 dias: ${describeTrend(stats.trend7d)}`,
      `Melhor dia histórico: ${stats.bestDay ? `${stats.bestDay.dayName}, média ${formatBRL(stats.bestDay.avgPrice)}` : "indisponível"}`
    );
  } else {
    lines.push("Histórico: insuficiente para calcular tendência com segurança");
  }

  lines.push(
    "",
    "Contexto de busca ao vivo:",
    ...(await describeLiveInsights(live)),
    "",
    "Responda em português do Brasil, em no máximo 8 linhas.",
    "Seja prático e honesto. Não invente dados.",
    "Priorize o preço ao vivo quando ele estiver disponível.",
    "Se a data foi assumida automaticamente, avise isso ao usuário e explique como perguntar com uma data específica.",
    "Dê uma recomendação explícita: comprar agora, esperar, ou criar alerta.",
    "Se os dados forem insuficientes para uma decisão forte, diga isso claramente.",
  );

  return lines.join("\n");
}

function fallbackAnswer(question: string, route: Route, stats: RouteStats | null, live: LiveSearchResult | null): string {
  const routeLabel = `${route.origin} → ${route.destination}`;
  const lines = [
    `🤖 *Minha leitura para ${routeLabel}:*`,
    "",
  ];

  if (live) {
    if (live.usedDefaultDate) {
      lines.push(`Não encontrei uma data na pergunta, então analisei uma ida para *${live.searchDate}*.`);
    }
    lines.push(
      `Menor preço ao vivo (${live.searchDate}): *${formatBRL(live.bestFlight.priceBRL)}*`,
      `Fonte: ${live.bestFlight.source}`,
    );
  }

  if (stats) {
    lines.push(
      `Último preço registrado: *${formatBRL(stats.latestPrice)}*`,
      `Menor histórico: *${formatOptionalMoney(stats.lowestEver)}*`,
      `Média 30d: *${formatOptionalMoney(stats.average30d)}*`,
      `Tendência: ${describeTrend(stats.trend7d)}`,
    );
  } else {
    lines.push("Histórico ainda insuficiente para uma análise forte.");
  }

  lines.push(
    "",
  );

  if (live && stats?.average30d && live.bestFlight.priceBRL <= stats.average30d * 0.95) {
    lines.push("Recomendação: *comprar agora* se a data fizer sentido. O preço ao vivo está abaixo da média recente.");
  } else if (stats?.currentVsAverage30dPct !== null && stats?.currentVsAverage30dPct !== undefined && stats.currentVsAverage30dPct <= -5) {
    lines.push("Recomendação: *comprar agora* se a data fizer sentido. O preço está abaixo da média recente.");
  } else if (stats?.currentVsLowestPct !== null && stats?.currentVsLowestPct !== undefined && stats.currentVsLowestPct > 20) {
    lines.push("Recomendação: *esperar ou criar alerta*. O preço atual está bem acima do menor histórico registrado.");
  } else {
    lines.push("Recomendação: *criar alerta* e monitorar. Os dados não mostram uma oportunidade muito forte agora.");
  }

  if (live?.usedDefaultDate) {
    lines.push("", "Para uma data específica, use:\n`/perguntar BSB GRU 20/07/2026 vale a pena comprar?`");
  }

  lines.push("", `_Pergunta analisada: ${question}_`);
  return lines.join("\n");
}

export async function answerTravelQuestion(question: string): Promise<string> {
  const route = extractRouteFromQuestion(question);
  if (!route) {
    return "❌ Não consegui identificar a rota.\n\nTente assim:\n`/perguntar BSB GRU vale a pena comprar agora?`";
  }

  const parsedDate = parseQuestionDate(question);

  const live = await fetchLiveRoutePrice(route, question, parsedDate);
  const stats = await buildRouteStats(route, parsedDate ?? undefined);
  if (!stats && !live) {
    return `📊 Ainda não tenho dados suficientes para *${route.origin} → ${route.destination}* e não consegui obter preço ao vivo agora.\n\nVocê pode criar um alerta para essa rota e perguntar de novo depois.`;
  }

  const prompt = await buildConciergePrompt(question, route, stats, live);
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

  const answer = aiAnswer ?? fallbackAnswer(question, route, stats, live);
  if (aiAnswer && live?.usedDefaultDate) {
    return `${answer}\n\n_Obs.: não encontrei uma data na pergunta, então analisei uma ida para ${live.searchDate}. Para escolher outra data, use: /perguntar BSB GRU 20/07/2026 vale a pena comprar?_`;
  }

  return answer;
}
