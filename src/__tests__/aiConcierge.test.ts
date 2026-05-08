const mockGetRoutePriceHistory = jest.fn();
const mockGetRouteLowestPrice = jest.fn();
const mockCompleteChat = jest.fn();

jest.mock("../services/history", () => ({
  getRoutePriceHistory: (...args: unknown[]) => mockGetRoutePriceHistory(...args),
  getRouteLowestPrice: (...args: unknown[]) => mockGetRouteLowestPrice(...args),
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
    expect(mockGetRoutePriceHistory).toHaveBeenCalledWith("BSB", "GRU");
    expect(mockGetRouteLowestPrice).toHaveBeenCalledWith("BSB", "GRU");
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
