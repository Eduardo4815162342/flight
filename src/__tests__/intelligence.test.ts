import { calculateRouteIntelligence } from "../services/intelligence";

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
