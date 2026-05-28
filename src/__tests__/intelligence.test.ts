import {
  buildDailyIntelligenceReport,
  calculateRouteIntelligence,
  renderDailyIntelligenceMarkdown,
} from "../services/intelligence";
import { HistoryEntry } from "../types";

function daysAgo(days: number, price: number, nowMs: number): [number, number] {
  return [Math.floor((nowMs - days * 24 * 60 * 60 * 1000) / 1000), price];
}

describe("calculateRouteIntelligence", () => {
  const nowMs = Date.UTC(2026, 4, 28, 12, 0, 0);

  it("gera score alto e recomendacao de compra para preco perto do menor historico", () => {
    const result = calculateRouteIntelligence({
      origin: "BSB",
      destination: "GRU",
      history: [
        daysAgo(20, 720, nowMs),
        daysAgo(10, 650, nowMs),
        daysAgo(1, 500, nowMs),
      ],
      nowMs,
    });

    expect(result).toEqual(expect.objectContaining({
      route: "BSB→GRU",
      sampleCount: 3,
      latestPrice: 500,
      lowestEver: 500,
      recommendation: "buy",
    }));
    expect(result!.dealScore).toBeGreaterThanOrEqual(80);
    expect(result!.currentVsAverage30dPct).toBeLessThan(0);
    expect(result!.reasons).toContain("preco perto do menor historico");
  });

  it("limita confianca quando ha poucas amostras", () => {
    const result = calculateRouteIntelligence({
      origin: "BSB",
      destination: "REC",
      history: [
        daysAgo(1, 350, nowMs),
        daysAgo(0, 340, nowMs),
      ],
      nowMs,
    });

    expect(result).toEqual(expect.objectContaining({
      recommendation: "monitor",
      sampleCount: 2,
    }));
    expect(result!.dealScore).toBeLessThanOrEqual(60);
    expect(result!.reasons).toContain("poucas amostras historicas");
  });

  it("recomenda esperar quando preco esta bem acima da media recente", () => {
    const result = calculateRouteIntelligence({
      origin: "BSB",
      destination: "FOR",
      history: [
        daysAgo(20, 500, nowMs),
        daysAgo(10, 520, nowMs),
        daysAgo(1, 700, nowMs),
      ],
      nowMs,
    });

    expect(result).toEqual(expect.objectContaining({
      recommendation: "wait",
      latestPrice: 700,
    }));
    expect(result!.dealScore).toBeLessThan(50);
    expect(result!.currentVsAverage30dPct).toBeGreaterThan(0);
  });
});

describe("buildDailyIntelligenceReport", () => {
  const now = "2026-05-28T12:00:00.000Z";

  function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
    return {
      timestamp: now,
      origin: "BSB",
      destination: "GRU",
      departureDate: "2026-07-20",
      totalFound: 3,
      cheapestPriceBRL: 500,
      flights: [],
      ...overrides,
    };
  }

  it("agrupa historico por rota e data de partida", () => {
    const report = buildDailyIntelligenceReport([
      entry({ timestamp: "2026-05-10T12:00:00.000Z", cheapestPriceBRL: 720 }),
      entry({ timestamp: "2026-05-20T12:00:00.000Z", cheapestPriceBRL: 650 }),
      entry({ timestamp: "2026-05-27T12:00:00.000Z", cheapestPriceBRL: 500 }),
      entry({
        origin: "BSB",
        destination: "FOR",
        departureDate: "2026-08-10",
        timestamp: "2026-05-27T12:00:00.000Z",
        cheapestPriceBRL: 900,
      }),
    ], now);

    expect(report.generatedAt).toBe(now);
    expect(report.totalHistoryEntries).toBe(4);
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toEqual(expect.objectContaining({
      route: "BSB→GRU",
      departureDate: "2026-07-20",
      recommendation: "buy",
    }));
    expect(report.topOpportunities[0].route).toBe("BSB→GRU");
    expect(report.insufficientData).toHaveLength(1);
    expect(report.insufficientData[0]).toEqual(expect.objectContaining({
      route: "BSB→FOR",
      sampleCount: 1,
    }));
  });

  it("ignora datas de partida expiradas", () => {
    const report = buildDailyIntelligenceReport([
      entry({
        departureDate: "2026-04-20",
        timestamp: "2026-05-10T12:00:00.000Z",
        cheapestPriceBRL: 500,
      }),
      entry({
        departureDate: "2026-04-20",
        timestamp: "2026-05-20T12:00:00.000Z",
        cheapestPriceBRL: 490,
      }),
      entry({
        departureDate: "2026-04-20",
        timestamp: "2026-05-27T12:00:00.000Z",
        cheapestPriceBRL: 480,
      }),
      entry({
        departureDate: "2026-07-20",
        timestamp: "2026-05-10T12:00:00.000Z",
        cheapestPriceBRL: 720,
      }),
      entry({
        departureDate: "2026-07-20",
        timestamp: "2026-05-20T12:00:00.000Z",
        cheapestPriceBRL: 650,
      }),
      entry({
        departureDate: "2026-07-20",
        timestamp: "2026-05-27T12:00:00.000Z",
        cheapestPriceBRL: 500,
      }),
    ], now);

    expect(report.items).toHaveLength(1);
    expect(report.items[0].departureDate).toBe("2026-07-20");
    expect(report.items.some((item) => item.departureDate === "2026-04-20")).toBe(false);
  });

  it("renderiza markdown com secoes principais", () => {
    const report = buildDailyIntelligenceReport([
      entry({ timestamp: "2026-05-10T12:00:00.000Z", cheapestPriceBRL: 720 }),
      entry({ timestamp: "2026-05-20T12:00:00.000Z", cheapestPriceBRL: 650 }),
      entry({ timestamp: "2026-05-27T12:00:00.000Z", cheapestPriceBRL: 500 }),
    ], now);

    const markdown = renderDailyIntelligenceMarkdown(report);

    expect(markdown).toContain("# BSB Price Track - Inteligencia diaria");
    expect(markdown).toContain("## Top oportunidades");
    expect(markdown).toContain("BSB→GRU");
    expect(markdown).toContain("Score");
    expect(markdown).toContain("2026-07-20");
  });
});
