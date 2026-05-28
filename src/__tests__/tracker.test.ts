import { Flight, TripType } from "../types";

const mockConfig = {
  apify: { tokens: ["tok"], actorId: "actor" },
  rapidapi: { key: "key", host: "host" },
  telegram: { botToken: "bot", chatId: "chat" },
  search: {
    origins: ["BSB"],
    origin: "BSB",
    destinations: ["GRU"],
    departureDate: "2026-06-01",
    dateRangeDays: 1,
    tripType: "one-way" as TripType,
    returnDate: undefined as string | undefined,
    maxPriceBRL: 300,
    priceDropThreshold: 0.95,
    priceErrorThreshold: 0.45,
  },
  filters: {
    airlinesWhitelist: [] as string[],
    maxStops: undefined as number | undefined,
    maxDurationHours: undefined as number | undefined,
  },
};

jest.mock("../config", () => ({ config: mockConfig }));

const mockSearchWithApify = jest.fn();
const mockSearchWithRapidAPI = jest.fn();
const mockSendFlightAlert = jest.fn();
const mockAppendHistory = jest.fn();
const mockGetLastCheapestPrice = jest.fn();
const mockGetRoutePriceHistory = jest.fn();
const mockGetAllActiveAlerts = jest.fn();

jest.mock("../apis/apify", () => ({
  searchWithApify: (...args: unknown[]) => mockSearchWithApify(...args),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: (...args: unknown[]) => mockSearchWithRapidAPI(...args),
}));

jest.mock("../services/telegram", () => ({
  sendFlightAlert: (...args: unknown[]) => mockSendFlightAlert(...args),
  sendSummary: jest.fn(),
  sendDateRangeSummary: jest.fn(),
  sendErrorAlert: jest.fn(),
}));

jest.mock("../services/history", () => ({
  appendHistory: (...args: unknown[]) => mockAppendHistory(...args),
  getLastCheapestPrice: (...args: unknown[]) => mockGetLastCheapestPrice(...args),
  getRoutePriceHistory: (...args: unknown[]) => mockGetRoutePriceHistory(...args),
}));

jest.mock("../services/user", () => ({
  getAllActiveAlerts: () => mockGetAllActiveAlerts(),
}));

jest.mock("../utils/retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllActiveAlerts.mockResolvedValue([]);
  mockGetLastCheapestPrice.mockResolvedValue(null);
  mockSearchWithApify.mockResolvedValue([]);
  mockGetRoutePriceHistory.mockResolvedValue([]);
});

function makeFlight(priceBRL: number): Flight {
  return {
    origin: "BSB",
    destination: "GRU",
    departureDate: "2026-06-01",
    tripType: "one-way",
    price: priceBRL,
    currency: "BRL",
    priceBRL,
    link: "https://example.com",
    source: "apify",
  };
}

describe("runTracker", () => {
  it("processa rotas globais do config", async () => {
    mockSearchWithApify.mockResolvedValue([makeFlight(200)]);
    const { runTracker } = await import("../services/tracker");
    await runTracker();
    expect(mockSearchWithApify).toHaveBeenCalled();
    expect(mockSendFlightAlert).toHaveBeenCalled();
  });

  it("processa alertas de usuários do banco", async () => {
    mockGetAllActiveAlerts.mockResolvedValue([
      {
        chat_id: "user123",
        origin: "BSB",
        destination: "FOR",
        departure_date: "2026-07-01",
        max_price_brl: 500,
        is_active: true,
        trip_type: "one-way"
      }
    ]);
    mockSearchWithApify.mockResolvedValue([makeFlight(400)]);
    
    const { runTracker } = await import("../services/tracker");
    await runTracker();
    
    // Deve buscar a rota do usuário
    expect(mockSearchWithApify).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "BSB", destination: "FOR" })
    );
    // Deve enviar alerta para o chat_id do usuário
    expect(mockSendFlightAlert).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      "user123",
      false,
      undefined
    );
  });

  it("consulta o preço anterior antes de gravar o histórico", async () => {
    mockSearchWithApify.mockResolvedValue([makeFlight(200)]);
    mockGetLastCheapestPrice.mockResolvedValue(250);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockGetLastCheapestPrice).toHaveBeenCalled();
    expect(mockAppendHistory).toHaveBeenCalled();
    expect(mockGetLastCheapestPrice.mock.invocationCallOrder[0])
      .toBeLessThan(mockAppendHistory.mock.invocationCallOrder[0]);
  });

  it("preserva campos ricos do voo ao gravar historico", async () => {
    mockSearchWithApify.mockResolvedValue([{
      ...makeFlight(200),
      price: 38,
      currency: "USD",
      airline: "LATAM",
      flightNumber: "LA 3264",
      airplane: "Airbus A321",
      stops: 0,
      durationMinutes: 105,
      priceInsights: {
        lowestPrice: 35,
        priceLevel: "low",
        typicalPriceRange: [50, 90],
        priceHistory: [[1716200000, 70]],
      },
    }]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockAppendHistory).toHaveBeenCalledWith(expect.objectContaining({
      flights: [
        expect.objectContaining({
          airline: "LATAM",
          price: 38,
          currency: "USD",
          priceBRL: 200,
          flightNumber: "LA 3264",
          airplane: "Airbus A321",
          stops: 0,
          durationMinutes: 105,
          priceInsights: expect.objectContaining({
            priceLevel: "low",
            lowestPrice: 35,
          }),
        }),
      ],
    }));
  });

  it("não envia alerta quando preço abaixo do limite não caiu o suficiente", async () => {
    mockSearchWithApify.mockResolvedValue([makeFlight(280)]);
    mockGetLastCheapestPrice.mockResolvedValue(290);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).not.toHaveBeenCalled();
  });

  it("envia alerta quando preço caiu pelo menos o threshold configurado", async () => {
    mockSearchWithApify.mockResolvedValue([makeFlight(270)]);
    mockGetLastCheapestPrice.mockResolvedValue(290);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalled();
  });

  describe("Detector de Erro de Tarifa", () => {
    it("detecta erro de tarifa com base no historico de data especifica (>=3 amostras)", async () => {
      // Configuração: média de 500, preço atual de 250 (50% de queda, superior ao threshold padrão de 45%)
      mockSearchWithApify.mockResolvedValue([makeFlight(250)]);
      mockGetRoutePriceHistory.mockResolvedValue([
        [1716200000, 500],
        [1716210000, 500],
        [1716220000, 500],
      ]);

      const { runTracker } = await import("../services/tracker");
      await runTracker();

      expect(mockSendFlightAlert).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Boolean),
        expect.any(String),
        true, // isPriceError
        expect.objectContaining({ discountPct: 50, averagePrice: 500 })
      );
    });

    it("detecta erro de tarifa com base no historico geral da rota quando data especifica tem <3 amostras", async () => {
      // Data especifica tem apenas 1 amostra, mas histórico geral tem 3 amostras (média 600)
      mockSearchWithApify.mockResolvedValue([makeFlight(300)]); // 50% queda
      
      // Chamada 1 para getRoutePriceHistory (data especifica) retorna 1 elemento
      // Chamada 2 para getRoutePriceHistory (rota geral) retorna 3 elementos
      mockGetRoutePriceHistory
        .mockResolvedValueOnce([[1716200000, 600]]) // data especifica
        .mockResolvedValueOnce([
          [1716200000, 600],
          [1716210000, 600],
          [1716220000, 600],
        ]); // rota geral

      const { runTracker } = await import("../services/tracker");
      await runTracker();

      expect(mockSendFlightAlert).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Boolean),
        expect.any(String),
        true, // isPriceError
        expect.objectContaining({ discountPct: 50, averagePrice: 600 })
      );
    });

    it("ignora deteccao de erro se amostragem total for <3", async () => {
      mockSearchWithApify.mockResolvedValue([makeFlight(150)]); // queda de 70% em relacao a media 500
      mockGetRoutePriceHistory.mockResolvedValue([
        [1716200000, 500],
        [1716210000, 500],
      ]); // Apenas 2 registros no total

      const { runTracker } = await import("../services/tracker");
      await runTracker();

      // Alerta padrao ainda enviado porque 150 <= maxPriceBRL (300)
      expect(mockSendFlightAlert).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Boolean),
        expect.any(String),
        false, // isPriceError deve ser false!
        undefined
      );
    });

    it("envia alerta de erro mesmo se o preco estiver acima do maxPriceBRL do usuario", async () => {
      // Preço atual de 400 (queda de 60% vs média de 1000), o que é acima do maxPriceBRL (300)
      mockSearchWithApify.mockResolvedValue([makeFlight(400)]);
      mockGetRoutePriceHistory.mockResolvedValue([
        [1716200000, 1000],
        [1716210000, 1000],
        [1716220000, 1000],
      ]);

      const { runTracker } = await import("../services/tracker");
      await runTracker();

      expect(mockSendFlightAlert).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Boolean),
        expect.any(String),
        true, // isPriceError
        expect.objectContaining({ discountPct: 60, averagePrice: 1000 })
      );
    });

    it("respeita anti-spam para erros de tarifa ja enviados", async () => {
      // Preço de 250 (erro de tarifa vs media 500), mas lastPrice é 250 (já enviado)
      mockSearchWithApify.mockResolvedValue([makeFlight(250)]);
      mockGetLastCheapestPrice.mockResolvedValue(250);
      mockGetRoutePriceHistory.mockResolvedValue([
        [1716200000, 500],
        [1716210000, 500],
        [1716220000, 500],
      ]);

      const { runTracker } = await import("../services/tracker");
      await runTracker();

      expect(mockSendFlightAlert).not.toHaveBeenCalled();
    });
  });
});
