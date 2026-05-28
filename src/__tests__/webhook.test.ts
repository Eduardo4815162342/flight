import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { handleUpdate } from "../services/webhook";
import * as userService from "../services/user";
import * as aiConcierge from "../services/aiConcierge";
import * as aiUsage from "../services/aiUsage";
import * as subscription from "../services/subscription";
import * as historyService from "../services/history";

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock("../config", () => ({
  config: {
    telegram: { botToken: "test-token", chatId: "123456789" },
    search:   { origin: "BSB" },
    rapidapi: { key: "test-rapidapi-key", host: "test-host" },
    apify:    { tokens: ["test-apify-token"] },
  },
}));

jest.mock("../apis/apify", () => ({
  searchWithApify: jest.fn(),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: jest.fn(),
}));

jest.mock("../services/user", () => ({
  isUserAuthorized: jest.fn(),
  saveUser:         jest.fn(),
  getUserInfo:      jest.fn(),
  authorizeUser:    jest.fn(),
  rejectUser:       jest.fn(),
  addAlert:         jest.fn(),
  listUserAlerts:   jest.fn(),
  removeAlert:      jest.fn(),
  updateAlertPrice: jest.fn(),
}));

jest.mock("../services/history", () => ({
  loadHistory: jest.fn().mockReturnValue([]),
  getRoutePriceHistory: jest.fn().mockResolvedValue([]),
  getRouteLowestPrice: jest.fn().mockResolvedValue(null),
  getLatestDepartureDate: jest.fn().mockResolvedValue(null),
}));

jest.mock("../services/aiConcierge", () => ({
  answerTravelQuestion: jest.fn(),
}));

jest.mock("../services/aiUsage", () => ({
  canAskAI: jest.fn(),
  recordAIQuery: jest.fn(),
}));

jest.mock("../services/subscription", () => ({
  activateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  formatSubscriptionStatus: jest.fn((access) => access.hasAccess ? "✅ Assinatura ativa" : "⏳ Seu acesso expirou."),
  getSubscriptionAccess: jest.fn(),
  startTrialIfMissing: jest.fn(),
}));

jest.mock("../services/db", () => ({
  getDb: jest.fn().mockReturnValue({
    execute: jest.fn().mockResolvedValue({ rows: [], rowsAffected: 1 }),
    close:   jest.fn(),
  }),
  initTables: jest.fn().mockResolvedValue(undefined),
}));

// ── Setup ──────────────────────────────────────────────────────────────────

const mock = new MockAdapter(axios);

const ADMIN_ID = 123456789;
const USER_ID  = 987654321;

// Helpers para construir updates Telegram
const msgUpdate = (
  chatId: number,
  text: string,
  firstName = "User",
  username?: string
) => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: chatId, type: "private" },
    text,
    from: { id: chatId, first_name: firstName, username },
  },
});

const callbackUpdate = (
  fromId: number,
  msgChatId: number,
  messageId: number,
  data: string
) => ({
  update_id: 2,
  callback_query: {
    id: "cq-id-1",
    from: { id: fromId, first_name: "Admin" },
    message: { message_id: messageId, chat: { id: msgChatId } },
    data,
  },
});

beforeEach(() => {
  mock.reset();
  jest.clearAllMocks();
  // Defaults seguros: sem estado no banco
  (userService.getUserInfo      as jest.Mock).mockResolvedValue(null);
  (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);
  (userService.saveUser         as jest.Mock).mockResolvedValue(undefined);
  (userService.authorizeUser    as jest.Mock).mockResolvedValue(undefined);
  (userService.rejectUser       as jest.Mock).mockResolvedValue(undefined);
  (aiConcierge.answerTravelQuestion as jest.Mock).mockResolvedValue("Resposta do concierge");
  (aiUsage.canAskAI as jest.Mock).mockResolvedValue({ allowed: true, used: 0, limit: 10 });
  (aiUsage.recordAIQuery as jest.Mock).mockResolvedValue(undefined);
  (subscription.getSubscriptionAccess as jest.Mock).mockResolvedValue({ hasAccess: true, status: "trialing", reason: "trial", daysLeft: 7 });
  (subscription.startTrialIfMissing as jest.Mock).mockResolvedValue(undefined);
  (subscription.activateSubscription as jest.Mock).mockResolvedValue(undefined);
  (subscription.cancelSubscription as jest.Mock).mockResolvedValue(undefined);
  (historyService.getRoutePriceHistory as jest.Mock).mockResolvedValue([]);
  (historyService.getRouteLowestPrice as jest.Mock).mockResolvedValue(null);
  (historyService.getLatestDepartureDate as jest.Mock).mockResolvedValue(null);
});

// ── Chat privado apenas ────────────────────────────────────────────────────

describe("Mensagens de grupo são ignoradas", () => {
  it("não responde a mensagens vindas de grupos", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 99,
      message: {
        message_id: 1,
        chat: { id: -100123456, type: "group" },
        text: "/start",
        from: { id: USER_ID, first_name: "João" },
      },
    });

    expect(mock.history.post).toHaveLength(0);
  });

  it("não responde a mensagens de supergrupos", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 100,
      message: {
        message_id: 2,
        chat: { id: -100999999, type: "supergroup" },
        text: "/alerta BSB GRU 01/01/2027 400",
        from: { id: USER_ID, first_name: "João" },
      },
    });

    expect(mock.history.post).toHaveLength(0);
  });
});

// ── /start ─────────────────────────────────────────────────────────────────

describe("/start", () => {
  it("autoriza o admin automaticamente e não notifica ninguém", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 10 } });
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(ADMIN_ID), is_authorized: 1,
    });

    await handleUpdate(msgUpdate(ADMIN_ID, "/start", "Admin"));

    // Apenas uma mensagem enviada: boas-vindas ao admin
    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Administrador");
  });

  it("notifica o admin com botões inline quando usuário é novo", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 11 } });
    // getUserInfo retorna null → usuário novo
    (userService.getUserInfo as jest.Mock).mockResolvedValue(null);

    await handleUpdate(msgUpdate(USER_ID, "/start", "João", "joao99"));

    // POST[0] = resposta ao usuário; POST[1] = notificação ao admin
    expect(mock.history.post).toHaveLength(2);

    const userMsg  = JSON.parse(mock.history.post[0].data);
    const adminMsg = JSON.parse(mock.history.post[1].data);

    expect(userMsg.text).toContain("pendente");
    expect(adminMsg.chat_id).toBe("123456789");
    expect(adminMsg.text).toContain("Novo usuário");
    expect(adminMsg.text).toContain(String(USER_ID));
    expect(adminMsg.reply_markup.inline_keyboard[0][0].callback_data).toBe(`authorize:${USER_ID}`);
    expect(adminMsg.reply_markup.inline_keyboard[0][1].callback_data).toBe(`reject:${USER_ID}`);
  });

  it("NÃO notifica o admin quando usuário pendente envia /start novamente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 12 } });
    // getUserInfo retorna pending (is_authorized = 0) → não é novo
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(USER_ID), is_authorized: 0,
    });

    await handleUpdate(msgUpdate(USER_ID, "/start", "João"));

    // Apenas a resposta ao usuário — sem notificação ao admin
    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("pendente");
  });

  it("informa usuário recusado sem notificar o admin", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 13 } });
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(USER_ID), is_authorized: -1,
    });

    await handleUpdate(msgUpdate(USER_ID, "/start", "João"));

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("negado");
  });

  it("envia boas-vindas de usuário já autorizado sem notificar admin", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 14 } });
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(USER_ID), is_authorized: 1,
    });

    await handleUpdate(msgUpdate(USER_ID, "/start", "João"));

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("autorizado");
  });
});

// ── callback_query — botões inline ─────────────────────────────────────────

describe("callback_query", () => {
  it("admin autoriza usuário via botão — atualiza DB, notifica usuário e edita mensagem", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 20 } });
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });
    mock.onPost(/editMessageText/).reply(200, { ok: true });

    await handleUpdate(callbackUpdate(ADMIN_ID, ADMIN_ID, 99, `authorize:${USER_ID}`));

    expect(userService.authorizeUser).toHaveBeenCalledWith(String(USER_ID));
    expect(subscription.startTrialIfMissing).toHaveBeenCalledWith(String(USER_ID));

    // answerCallbackQuery + sendMessage (usuário) + editMessageText
    const urls = mock.history.post.map(r => r.url);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/answerCallbackQuery`);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/sendMessage`);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/editMessageText`);

    const userNotif = mock.history.post.find(r =>
      r.url?.includes("sendMessage") && JSON.parse(r.data).chat_id === String(USER_ID)
    );
    expect(JSON.parse(userNotif!.data).text).toContain("aprovado");
  });

  it("admin recusa usuário via botão — atualiza DB, notifica usuário e edita mensagem", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 21 } });
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });
    mock.onPost(/editMessageText/).reply(200, { ok: true });

    await handleUpdate(callbackUpdate(ADMIN_ID, ADMIN_ID, 99, `reject:${USER_ID}`));

    expect(userService.rejectUser).toHaveBeenCalledWith(String(USER_ID));

    const userNotif = mock.history.post.find(r =>
      r.url?.includes("sendMessage") && JSON.parse(r.data).chat_id === String(USER_ID)
    );
    expect(JSON.parse(userNotif!.data).text).toContain("negado");
  });

  it("não-admin não consegue acionar botão de autorização", async () => {
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });

    const OUTSIDER_ID = 111222333;
    await handleUpdate(callbackUpdate(OUTSIDER_ID, ADMIN_ID, 99, `authorize:${USER_ID}`));

    expect(userService.authorizeUser).not.toHaveBeenCalled();

    const answer = JSON.parse(mock.history.post[0].data);
    expect(answer.text).toContain("não permitida");
  });

  it("ignora callback_query com dados inválidos (sem ':')", async () => {
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });

    await handleUpdate(callbackUpdate(ADMIN_ID, ADMIN_ID, 99, "malformed_data"));

    expect(userService.authorizeUser).not.toHaveBeenCalled();
    expect(userService.rejectUser).not.toHaveBeenCalled();
  });
});

// ── Comandos autenticados ──────────────────────────────────────────────────

describe("Comandos de Alerta", () => {
  beforeEach(() => {
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
  });

  it("permite criar alerta quando autorizado", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.addAlert as jest.Mock).mockResolvedValue(123);

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 20/12/2026 500"));

    expect(userService.addAlert).toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Alerta criado");
  });

  it("rejeita alerta com aeroporto inválido", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/alerta BRASILIA GRU 20/12/2026 500"));

    expect(userService.addAlert).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("IATA");
  });

  it("rejeita alerta com data inválida", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 31/02/2026 500"));

    expect(userService.addAlert).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Data inválida");
  });

  it("rejeita alerta de ida e volta com volta antes da ida", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 20/12/2026 19/12/2026 500"));

    expect(userService.addAlert).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("volta precisa ser depois");
  });

  it("rejeita alerta com preço inválido", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 20/12/2026 abc"));

    expect(userService.addAlert).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Preço inválido");
  });

  it("interpreta preço em formato brasileiro", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.addAlert as jest.Mock).mockResolvedValue(123);

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 20/12/2026 R$1.200,50"));

    expect(userService.addAlert).toHaveBeenCalledWith(expect.objectContaining({
      max_price_brl: 1200.5,
    }));
  });

  it("bloqueia /status para usuário autorizado que não é admin", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/status"));

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("restrito ao administrador");
  });

  it("bloqueia /autorizar para usuário autorizado que não é admin", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, `/autorizar ${ADMIN_ID}`));

    expect(userService.authorizeUser).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("restrito ao administrador");
  });

  it("admin ativa assinatura manualmente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);

    await handleUpdate(msgUpdate(ADMIN_ID, `/ativar ${USER_ID} 30`, "Admin"));

    expect(subscription.activateSubscription).toHaveBeenCalledWith(String(USER_ID), 30);
    expect(mock.history.post).toHaveLength(2);
    expect(JSON.parse(mock.history.post[0].data).text).toContain("ativada por");
  });

  it("admin cancela assinatura manualmente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);

    await handleUpdate(msgUpdate(ADMIN_ID, `/cancelar ${USER_ID}`, "Admin"));

    expect(subscription.cancelSubscription).toHaveBeenCalledWith(String(USER_ID));
    expect(mock.history.post).toHaveLength(2);
    expect(JSON.parse(mock.history.post[0].data).text).toContain("cancelada");
  });

  it("permite editar preço de um alerta existente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.updateAlertPrice as jest.Mock).mockResolvedValue(true);

    await handleUpdate(msgUpdate(USER_ID, "/editar 5 600"));

    expect(userService.updateAlertPrice).toHaveBeenCalledWith(String(USER_ID), 5, 600);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("atualizado para");
  });

  it("permite remover um alerta existente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.removeAlert as jest.Mock).mockResolvedValue(true);

    await handleUpdate(msgUpdate(USER_ID, "/remover 10"));

    expect(userService.removeAlert).toHaveBeenCalledWith(String(USER_ID), 10);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("removido com sucesso");
  });

  it("marca alertas com data passada como expirados em /meusalertas", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.listUserAlerts as jest.Mock).mockResolvedValue([
      {
        id: 10,
        origin: "BSB",
        destination: "GRU",
        departure_date: "2000-01-01",
        trip_type: "one-way",
        max_price_brl: 500,
        is_active: true,
      },
      {
        id: 11,
        origin: "BSB",
        destination: "AJU",
        departure_date: "2099-01-01",
        trip_type: "one-way",
        max_price_brl: 600,
        is_active: true,
      },
    ]);

    await handleUpdate(msgUpdate(USER_ID, "/meusalertas"));

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("BSB → GRU");
    expect(body.text).toContain("⚠️ *Expirado*");
    expect(body.text).toContain("Esse voo já passou");
    expect(body.text).toContain("/remover 10");
    expect(body.text).toContain("BSB → AJU");
  });

  it("processa /perguntar usando o concierge de IA", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/perguntar Vale a pena comprar BSB→GRU agora?"));

    expect(aiUsage.canAskAI).toHaveBeenCalledWith(String(USER_ID));
    expect(aiConcierge.answerTravelQuestion).toHaveBeenCalledWith("Vale a pena comprar BSB→GRU agora?");
    expect(aiUsage.recordAIQuery).toHaveBeenCalledWith(String(USER_ID), "Vale a pena comprar BSB→GRU agora?", true);
    expect(mock.history.post).toHaveLength(2);
    expect(JSON.parse(mock.history.post[0].data).text).toContain("Analisando");
    expect(JSON.parse(mock.history.post[1].data).text).toContain("Resposta do concierge");
  });

  it("orienta o formato quando /perguntar vem sem pergunta", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/perguntar"));

    expect(aiConcierge.answerTravelQuestion).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("/perguntar BSB GRU");
  });

  it("bloqueia /perguntar quando usuário atinge limite de IA", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (aiUsage.canAskAI as jest.Mock).mockResolvedValue({ allowed: false, used: 10, limit: 10 });

    await handleUpdate(msgUpdate(USER_ID, "/perguntar BSB GRU vale a pena?"));

    expect(aiConcierge.answerTravelQuestion).not.toHaveBeenCalled();
    expect(aiUsage.recordAIQuery).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("atingiu o limite");
  });

  it("registra falha de /perguntar quando concierge lança erro", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (aiConcierge.answerTravelQuestion as jest.Mock).mockRejectedValue(new Error("boom"));

    await handleUpdate(msgUpdate(USER_ID, "/perguntar BSB GRU vale a pena?"));

    expect(aiUsage.recordAIQuery).toHaveBeenCalledWith(String(USER_ID), "BSB GRU vale a pena?", false);
    const lastMessage = JSON.parse(mock.history.post[mock.history.post.length - 1].data);
    expect(lastMessage.text).toContain("Erro ao processar comando");
  });

  it("bloqueia comandos para usuários não autorizados", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);

    await handleUpdate(msgUpdate(USER_ID, "/meusalertas"));

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Acesso negado");
  });

  it("bloqueia comandos pagos quando assinatura expirou", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
    (subscription.getSubscriptionAccess as jest.Mock).mockResolvedValue({
      hasAccess: false,
      status: "trialing",
      reason: "expired",
    });

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 20/12/2026 500"));

    expect(userService.addAlert).not.toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("renove sua assinatura");
  });

  it("permite consultar /assinatura mesmo sem acesso pago", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
    (subscription.getSubscriptionAccess as jest.Mock).mockResolvedValue({
      hasAccess: false,
      status: "trialing",
      reason: "expired",
    });

    await handleUpdate(msgUpdate(USER_ID, "/assinatura"));

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("comandos de busca");
  });
});

describe("Comando /tendencia", () => {
  beforeEach(() => {
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
  });

  it("exibe orientacoes se argumentos forem insuficientes", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate(msgUpdate(USER_ID, "/tendencia BSB"));

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Formato: `/tendencia");
  });

  it("informa falta de registros se historico tiver menos de 2 entradas", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (historyService.getRoutePriceHistory as jest.Mock).mockResolvedValue([[1716200000, 500]]);

    await handleUpdate(msgUpdate(USER_ID, "/tendencia BSB GRU"));

    // POST[0] = "Analisando...", POST[1] = "Sem dados suficientes"
    expect(mock.history.post).toHaveLength(2);
    const body = JSON.parse(mock.history.post[1].data);
    expect(body.text).toContain("Sem dados suficientes");
  });

  it("gera grafico via QuickChart e envia como sendPhoto quando ha historico suficiente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mock.onPost(/sendPhoto/).reply(200, { ok: true });
    (historyService.getRoutePriceHistory as jest.Mock).mockResolvedValue([
      [1716200000, 500],
      [1716210000, 480],
    ]);

    await handleUpdate(msgUpdate(USER_ID, "/tendencia BSB GRU"));

    // Devem ter 2 posts:
    // 1. sendMessage (Analisando...)
    // 2. sendPhoto (Gráfico + Legenda)
    const urls = mock.history.post.map((r) => r.url);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/sendMessage`);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/sendPhoto`);

    const photoCall = mock.history.post.find((r) => r.url?.includes("sendPhoto"));
    const body = JSON.parse(photoCall!.data);
    expect(body.photo).toContain("quickchart.io/chart");
    expect(body.caption).toContain("Tendência BSB → GRU");
    expect(body.caption).toContain("Último preço");
  });

  it("cai para texto via sendMessage (fallback) caso o sendPhoto falhe", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mock.onPost(/sendPhoto/).reply(500); // Falha de rede/API
    (historyService.getRoutePriceHistory as jest.Mock).mockResolvedValue([
      [1716200000, 500],
      [1716210000, 480],
    ]);

    await handleUpdate(msgUpdate(USER_ID, "/tendencia BSB GRU"));

    // Deve enviar 2 posts para sendMessage:
    // 1. Analisando...
    // 2. Fallback de texto da tendência
    const sendMessages = mock.history.post.filter((r) => r.url?.includes("sendMessage"));
    expect(sendMessages).toHaveLength(2);

    const fallbackBody = JSON.parse(sendMessages[1].data);
    expect(fallbackBody.text).toContain("Tendência BSB → GRU");
    expect(fallbackBody.text).toContain("Último preço");
  });
});
