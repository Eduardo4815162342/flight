import {
  buildPersonalizedRadarReports,
  renderPersonalizedRadarMessage,
} from "../services/personalizedRadar";
import { HistoryEntry } from "../types";
import { UserAlert } from "../services/user";

jest.mock("../config", () => ({
  config: {
    telegram: {
      botToken: "test-token",
      chatId: "admin-chat",
    },
    search: {
      priceErrorThreshold: 0.45,
    },
  },
}));

const generatedAt = "2026-05-28T12:00:00.000Z";

function alert(overrides: Partial<UserAlert>): UserAlert {
  return {
    id: 1,
    chat_id: "user-1",
    origin: "BSB",
    destination: "GRU",
    departure_date: "2026-07-20",
    trip_type: "one-way",
    max_price_brl: 600,
    is_active: true,
    ...overrides,
  };
}

function history(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    timestamp: "2026-05-28T10:00:00.000Z",
    origin: "BSB",
    destination: "GRU",
    departureDate: "2026-07-20",
    totalFound: 3,
    cheapestPriceBRL: 500,
    flights: [],
    ...overrides,
  };
}

describe("buildPersonalizedRadarReports", () => {
  it("agrupa alertas por usuario e recomenda comprar quando preco esta bom e dentro do limite", () => {
    const reports = buildPersonalizedRadarReports({
      alerts: [alert({ chat_id: "user-1", max_price_brl: 600 })],
      history: [
        history({ timestamp: "2026-05-10T10:00:00.000Z", cheapestPriceBRL: 720 }),
        history({ timestamp: "2026-05-20T10:00:00.000Z", cheapestPriceBRL: 650 }),
        history({ timestamp: "2026-05-28T10:00:00.000Z", cheapestPriceBRL: 500 }),
      ],
      generatedAt,
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(expect.objectContaining({
      chatId: "user-1",
      totalAlerts: 1,
    }));
    expect(reports[0].items[0]).toEqual(expect.objectContaining({
      route: "BSB → GRU",
      departureDate: "2026-07-20",
      action: "buy",
      latestPrice: 500,
      maxPriceBRL: 600,
    }));
  });

  it("destaca possivel erro de tarifa quando preco cai muito abaixo da media", () => {
    const reports = buildPersonalizedRadarReports({
      alerts: [alert({ max_price_brl: 900 })],
      history: [
        history({ timestamp: "2026-05-10T10:00:00.000Z", cheapestPriceBRL: 1000 }),
        history({ timestamp: "2026-05-20T10:00:00.000Z", cheapestPriceBRL: 980 }),
        history({ timestamp: "2026-05-28T10:00:00.000Z", cheapestPriceBRL: 420 }),
      ],
      generatedAt,
      priceErrorThreshold: 0.45,
    });

    expect(reports[0].items[0]).toEqual(expect.objectContaining({
      action: "price_error",
      latestPrice: 420,
    }));
    expect(reports[0].items[0].reasons.join(" ")).toContain("erro de tarifa");
  });

  it("recomenda esperar quando preco esta acima do limite do alerta", () => {
    const reports = buildPersonalizedRadarReports({
      alerts: [alert({ max_price_brl: 550 })],
      history: [
        history({ timestamp: "2026-05-10T10:00:00.000Z", cheapestPriceBRL: 500 }),
        history({ timestamp: "2026-05-20T10:00:00.000Z", cheapestPriceBRL: 520 }),
        history({ timestamp: "2026-05-28T10:00:00.000Z", cheapestPriceBRL: 800 }),
      ],
      generatedAt,
    });

    expect(reports[0].items[0]).toEqual(expect.objectContaining({
      action: "wait",
      latestPrice: 800,
      maxPriceBRL: 550,
    }));
  });

  it("recomenda esperar quando inteligencia ve preco caro mesmo abaixo de limite generoso", () => {
    const reports = buildPersonalizedRadarReports({
      alerts: [alert({ max_price_brl: 1200 })],
      history: [
        history({ timestamp: "2026-05-10T10:00:00.000Z", cheapestPriceBRL: 500 }),
        history({ timestamp: "2026-05-20T10:00:00.000Z", cheapestPriceBRL: 520 }),
        history({ timestamp: "2026-05-28T10:00:00.000Z", cheapestPriceBRL: 800 }),
      ],
      generatedAt,
    });

    expect(reports[0].items[0]).toEqual(expect.objectContaining({
      action: "wait",
      latestPrice: 800,
      maxPriceBRL: 1200,
    }));
  });

  it("marca criar alerta quando nao ha dados suficientes para decisao forte", () => {
    const reports = buildPersonalizedRadarReports({
      alerts: [alert({ destination: "FOR", departure_date: "2026-08-10" })],
      history: [
        history({
          destination: "FOR",
          departureDate: "2026-08-10",
          timestamp: "2026-05-28T10:00:00.000Z",
          cheapestPriceBRL: 700,
        }),
      ],
      generatedAt,
    });

    expect(reports[0].items[0]).toEqual(expect.objectContaining({
      action: "create_alert",
      sampleCount: 1,
    }));
  });

  it("ignora alertas com data de partida expirada", () => {
    const reports = buildPersonalizedRadarReports({
      alerts: [alert({ departure_date: "2026-04-10" })],
      history: [
        history({ departureDate: "2026-04-10", cheapestPriceBRL: 300 }),
      ],
      generatedAt,
    });

    expect(reports).toEqual([]);
  });
});

describe("renderPersonalizedRadarMessage", () => {
  it("renderiza resumo acionavel para Telegram", () => {
    const [report] = buildPersonalizedRadarReports({
      alerts: [alert({ max_price_brl: 600 })],
      history: [
        history({ timestamp: "2026-05-10T10:00:00.000Z", cheapestPriceBRL: 720 }),
        history({ timestamp: "2026-05-20T10:00:00.000Z", cheapestPriceBRL: 650 }),
        history({ timestamp: "2026-05-28T10:00:00.000Z", cheapestPriceBRL: 500 }),
      ],
      generatedAt,
    });

    const message = renderPersonalizedRadarMessage(report);

    expect(message).toContain("Radar inteligente");
    expect(message).toContain("Comprar agora");
    expect(message).toContain("BSB → GRU");
    expect(message).toContain("R$");
    expect(message).toContain("/editar 1");
  });
});
