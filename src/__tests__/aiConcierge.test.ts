const mockGetRoutePriceHistory = jest.fn();
const mockGetRouteLowestPrice = jest.fn();
const mockAppendHistory = jest.fn();
const mockCompleteChat = jest.fn();
const mockSearchWithApify = jest.fn();
const mockSearchWithRapidAPI = jest.fn();

jest.mock("../services/history", () => ({
  appendHistory: (...args: unknown[]) => mockAppendHistory(...args),
  getRoutePriceHistory: (...args: unknown[]) => mockGetRoutePriceHistory(...args),
  getRouteLowestPrice: (...args: unknown[]) => mockGetRouteLowestPrice(...args),
}));

jest.mock("../apis/apify", () => ({
  searchWithApify: (...args: unknown[]) => mockSearchWithApify(...args),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: (...args: unknown[]) => mockSearchWithRapidAPI(...args),
}));

jest.mock("../services/openrouter", () => ({
  completeChat: (...args: unknown[]) => mockCompleteChat(...args),
}));

function daysAgo(days: number, price: number): [number, number] {
  return [Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000), price];
}

describe("aiConcierge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppendHistory.mockResolvedValue(undefined);
    mockSearchWithApify.mockResolvedValue([]);
    mockSearchWithRapidAPI.mockResolvedValue([]);
    mockGetRouteLowestPrice.mockResolvedValue(487);
    mockCompleteChat.mockResolvedValue("Resposta contextual da IA");
  });

  it("extrai rota com seta e rota com espaços", async () => {
    const { extractRouteFromQuestion } = await import("../services/aiConcierge");

    expect(extractRouteFromQuestion("Vale a pena comprar BSB→GRU agora?")).toEqual({
      origin: "BSB",
      destination: "GRU",
    });
    expect(extractRouteFromQuestion("BSB GRU está caro?")).toEqual({
      origin: "BSB",
      destination: "GRU",
    });
  });

  it("pede formato quando não identifica rota", async () => {
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    const answer = await answerTravelQuestion("vale a pena comprar agora?");

    expect(answer).toContain("Não consegui identificar a rota");
    expect(mockGetRoutePriceHistory).not.toHaveBeenCalled();
  });

  it("informa falta de dados quando histórico é insuficiente", async () => {
    mockGetRoutePriceHistory.mockResolvedValue([daysAgo(1, 612)]);
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    const answer = await answerTravelQuestion("BSB GRU vale a pena comprar agora?");

    expect(answer).toContain("Ainda não tenho dados suficientes");
    expect(answer).toContain("BSB → GRU");
    expect(mockCompleteChat).not.toHaveBeenCalled();
  });

  it("envia contexto real da rota para o OpenRouter", async () => {
    mockGetRoutePriceHistory.mockResolvedValue([
      daysAgo(20, 487),
      daysAgo(10, 575),
      daysAgo(1, 612),
    ]);
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    const answer = await answerTravelQuestion("Vale a pena comprar BSB->GRU agora?");

    expect(answer).toBe("Resposta contextual da IA");
    expect(mockGetRoutePriceHistory).toHaveBeenCalledWith("BSB", "GRU", undefined);
    expect(mockGetRouteLowestPrice).toHaveBeenCalledWith("BSB", "GRU", undefined);
    expect(mockCompleteChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("Rota: BSB → GRU"),
        }),
      ]),
      expect.objectContaining({ maxTokens: 420, temperature: 0.2 })
    );

    const userMessage = mockCompleteChat.mock.calls[0][0][1].content.replace(/\s/g, " ");
    expect(userMessage).toContain("Último preço registrado: R$ 612,00");
    expect(userMessage).toContain("Menor preço histórico: R$ 487,00");
  });

  it("inclui preço ao vivo no contexto e salva snapshot no histórico", async () => {
    mockSearchWithApify.mockResolvedValue([
      {
        origin: "BSB",
        destination: "GRU",
        departureDate: "2026-07-20",
        tripType: "one-way",
        price: 520,
        currency: "BRL",
        priceBRL: 520,
        airline: "LATAM",
        stops: 0,
        link: "https://example.com",
        source: "apify",
      },
    ]);
    mockGetRoutePriceHistory.mockResolvedValue([
      daysAgo(20, 487),
      daysAgo(10, 575),
      daysAgo(1, 612),
    ]);
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    await answerTravelQuestion("BSB GRU 20/07/2026 vale a pena comprar agora?");

    expect(mockSearchWithApify).toHaveBeenCalledWith(expect.objectContaining({
      origin: "BSB",
      destination: "GRU",
      departureDate: "2026-07-20",
      ignoreMaxPrice: true,
    }));
    expect(mockAppendHistory).toHaveBeenCalledWith(expect.objectContaining({
      origin: "BSB",
      destination: "GRU",
      departureDate: "2026-07-20",
      cheapestPriceBRL: 520,
      totalFound: 1,
    }));

    const userMessage = mockCompleteChat.mock.calls[0][0][1].content.replace(/\s/g, " ");
    expect(userMessage).toContain("Busca ao vivo para 2026-07-20");
    expect(userMessage).toContain("Data da busca foi assumida automaticamente: não");
    expect(userMessage).toContain("Menor preço ao vivo: R$ 520,00");
    expect(userMessage).toContain("Companhia do menor preço: LATAM");
  });

  it("avisa quando usa data padrão por falta de data explícita", async () => {
    mockSearchWithApify.mockResolvedValue([
      {
        origin: "BSB",
        destination: "GRU",
        departureDate: "2026-07-20",
        tripType: "one-way",
        price: 520,
        currency: "BRL",
        priceBRL: 520,
        link: "https://example.com",
        source: "apify",
      },
    ]);
    mockGetRoutePriceHistory.mockResolvedValue([
      daysAgo(20, 487),
      daysAgo(10, 575),
      daysAgo(1, 612),
    ]);
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    const answer = await answerTravelQuestion("BSB GRU vale a pena comprar agora?");

    expect(answer).toContain("não encontrei uma data");
    expect(answer).toContain("/perguntar BSB GRU 20/07/2026");

    const userMessage = mockCompleteChat.mock.calls[0][0][1].content.replace(/\s/g, " ");
    expect(userMessage).toContain("Data da busca foi assumida automaticamente: sim");
  });

  it("usa RapidAPI quando Apify falha na busca ao vivo", async () => {
    mockSearchWithApify.mockRejectedValue(new Error("apify down"));
    mockSearchWithRapidAPI.mockResolvedValue([
      {
        origin: "BSB",
        destination: "GRU",
        departureDate: "2026-07-20",
        tripType: "one-way",
        price: 540,
        currency: "BRL",
        priceBRL: 540,
        link: "https://example.com",
        source: "rapidapi",
      },
    ]);
    mockGetRoutePriceHistory.mockResolvedValue([
      daysAgo(20, 487),
      daysAgo(10, 575),
      daysAgo(1, 612),
    ]);
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    await answerTravelQuestion("BSB GRU 20/07/2026 comprar agora?");

    expect(mockSearchWithRapidAPI).toHaveBeenCalledWith(expect.objectContaining({
      origin: "BSB",
      destination: "GRU",
      departureDate: "2026-07-20",
    }));
    expect(mockAppendHistory).toHaveBeenCalledWith(expect.objectContaining({
      cheapestPriceBRL: 540,
      totalFound: 1,
    }));
  });

  it("usa resposta local quando OpenRouter não retorna conteúdo", async () => {
    mockGetRoutePriceHistory.mockResolvedValue([
      daysAgo(20, 487),
      daysAgo(10, 575),
      daysAgo(1, 612),
    ]);
    mockCompleteChat.mockResolvedValue(null);
    const { answerTravelQuestion } = await import("../services/aiConcierge");

    const answer = await answerTravelQuestion("BSB GRU está caro?");

    expect(answer).toContain("Minha leitura para BSB → GRU");
    expect(answer).toContain("Último preço registrado");
  });
});
