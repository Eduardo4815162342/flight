import { getCached, setCached, buildCacheKey, clearCache } from "../utils/liveSearchCache";
import { Flight } from "../types";

const fakeFlight: Flight = {
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-07-20",
  tripType: "one-way",
  price: 100,
  currency: "USD",
  priceBRL: 550,
  link: "https://example.com",
  source: "apify",
};

const fakeResult = {
  searchDate: "2026-07-20",
  usedDefaultDate: false,
  totalFound: 3,
  bestFlight: fakeFlight,
};

beforeEach(() => {
  clearCache();
});

describe("buildCacheKey", () => {
  it("gera chave consistente para mesmos parâmetros", () => {
    expect(buildCacheKey("BSB", "GRU", "2026-07-20")).toBe("BSB:GRU:2026-07-20");
  });
});

describe("getCached / setCached", () => {
  it("retorna null quando não há entrada no cache", () => {
    expect(getCached("BSB", "GRU", "2026-07-20")).toBeNull();
  });

  it("retorna resultado depois de setCached", () => {
    setCached("BSB", "GRU", "2026-07-20", fakeResult, 3600_000);
    expect(getCached("BSB", "GRU", "2026-07-20")).toEqual(fakeResult);
  });

  it("retorna null quando entrada expirou", () => {
    setCached("BSB", "FOR", "2026-07-20", fakeResult, -1);
    expect(getCached("BSB", "FOR", "2026-07-20")).toBeNull();
  });

  it("diferentes rotas têm entradas independentes", () => {
    setCached("BSB", "GRU", "2026-07-20", fakeResult, 3600_000);
    expect(getCached("BSB", "FOR", "2026-07-20")).toBeNull();
  });
});
