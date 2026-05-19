import { HistoryEntry } from "../types";
import { appendHistory, loadHistory, getLastCheapestPrice, getWeeklySummary } from "../services/history";

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  timestamp: "2026-03-24T10:00:00.000Z",
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-03-29",
  totalFound: 2,
  cheapestPriceBRL: 1500,
  flights: [
    { airline: "Gol", priceBRL: 1500, departureTime: "2026-03-29 10:00", link: "https://example.com", source: "apify" },
  ],
  ...overrides,
});

describe("History Service (Turso Async)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadHistory", () => {
    it("retorna as entradas do banco", async () => {
      const history = await loadHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("appendHistory", () => {
    it("consegue salvar uma nova entrada", async () => {
      await appendHistory(makeEntry());
      // Como o banco está mockado no setup.ts, apenas verificamos se não explode
    });
  });

  describe("getLastCheapestPrice", () => {
    it("retorna null quando o banco está vazio", async () => {
      const price = await getLastCheapestPrice("BSB", "GRU", "2026-03-29");
      expect(price).toBeNull();
    });
  });

  describe("getWeeklySummary", () => {
    it("retorna array vazio quando não há dados", async () => {
      const summaries = await getWeeklySummary();
      expect(summaries).toEqual([]);
    });
  });

  describe("getRoutePriceHistory", () => {
    it("retorna array vazio quando o banco está vazio", async () => {
      const { getRoutePriceHistory } = await import("../services/history");
      const result = await getRoutePriceHistory("BSB", "GRU");
      expect(result).toEqual([]);
    });

    it("aceita filtro opcional de departureDate", async () => {
      const { getRoutePriceHistory } = await import("../services/history");
      const result = await getRoutePriceHistory("BSB", "GRU", "2026-07-20");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getLatestDepartureDate", () => {
    it("retorna null quando o banco está vazio", async () => {
      const { getLatestDepartureDate } = await import("../services/history");
      const result = await getLatestDepartureDate("BSB", "GRU");
      expect(result).toBeNull();
    });
  });

  describe("getRouteLowestPrice with departureDate", () => {
    it("aceita filtro opcional de departureDate", async () => {
      const { getRouteLowestPrice } = await import("../services/history");
      const result = await getRouteLowestPrice("BSB", "GRU", "2026-07-20");
      expect(result).toBeNull();
    });
  });
});
