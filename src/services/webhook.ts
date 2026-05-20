import http from "http";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { formatBRL } from "./currency";
import * as userService from "./user";
import { getDb } from "./db";
import { getRoutePriceHistory, getRouteLowestPrice, getLatestDepartureDate, getFullHistory } from "./history";
import { calcTrend, bestDayOfWeek } from "../utils/priceHistory";
import { answerTravelQuestion } from "./aiConcierge";
import { canAskAI, recordAIQuery } from "./aiUsage";
import { getCached, setCached } from "../utils/liveSearchCache";
import { calcCPM, buildCPMRecommendation } from "../utils/cpm";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import {
  activateSubscription,
  cancelSubscription,
  formatSubscriptionStatus,
  getSubscriptionAccess,
  startTrialIfMissing,
} from "./subscription";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
const TIMEOUT_MS = 10_000;
// Railway injeta $PORT dinamicamente — tem prioridade sobre WEBHOOK_PORT
const WEBHOOK_PORT = Number(process.env.PORT ?? process.env.WEBHOOK_PORT ?? "3000");

// ── Tipos Telegram ──────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

// ── Helpers de API do Telegram ──────────────────────────────────────────────

export async function sendReply(chatId: number | string, text: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true },
      { timeout: TIMEOUT_MS }
    );
  } catch (err) {
    console.error(`[webhook] Erro ao enviar mensagem para ${chatId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Envia foto com legenda via Telegram.
 * Possui fallback automático para mensagem de texto caso o envio falhe.
 */
export async function sendPhotoReply(
  chatId: number | string,
  photoUrl: string,
  caption?: string
): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/sendPhoto`,
      {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "Markdown",
      },
      { timeout: TIMEOUT_MS }
    );
  } catch (err) {
    console.error(`[webhook] Erro ao enviar foto para ${chatId}:`, err instanceof Error ? err.message : err);
    if (caption) {
      // Fallback seguro de texto puro
      await sendReply(chatId, caption);
    }
  }
}


/**
 * Envia mensagem com teclado inline (botões).
 * Retorna o message_id da mensagem enviada, ou null em caso de falha.
 */
export async function sendWithInlineKeyboard(
  chatId: string,
  text: string,
  keyboard: { text: string; callback_data: string }[][]
): Promise<number | null> {
  try {
    const res = await axios.post<{ ok: boolean; result: { message_id: number } }>(
      `${BASE_URL}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard },
      },
      { timeout: TIMEOUT_MS }
    );
    return res.data.result?.message_id ?? null;
  } catch (err) {
    console.error("[webhook] Erro ao enviar mensagem com botões:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Responde a um callback_query — indispensável para remover o "carregando" do botão. */
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/answerCallbackQuery`,
      { callback_query_id: callbackQueryId, text: text ?? "" },
      { timeout: TIMEOUT_MS }
    );
  } catch {
    // Silencioso — não impede o fluxo principal
  }
}

/** Edita o texto de uma mensagem já enviada (remove os botões após ação). */
async function editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/editMessageText`,
      { chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown" },
      { timeout: TIMEOUT_MS }
    );
  } catch {
    // Silencioso — mensagem pode ter expirado
  }
}

// ── Handlers de Comandos ────────────────────────────────────────────────────

/**
 * Notifica o admin que um novo usuário iniciou o bot,
 * com botões inline para autorizar ou recusar.
 */
async function notifyAdminNewUser(chatId: string, firstName?: string, username?: string): Promise<void> {
  const name = firstName ?? "Sem nome";
  const handle = username ? `@${username}` : "sem username";
  const text =
    `🆕 *Novo usuário solicitando acesso*\n\n` +
    `👤 Nome: ${name}\n` +
    `🔗 Username: ${handle}\n` +
    `🆔 ID: \`${chatId}\``;

  await sendWithInlineKeyboard(config.telegram.chatId, text, [[
    { text: "✅ Autorizar", callback_data: `authorize:${chatId}` },
    { text: "❌ Recusar",   callback_data: `reject:${chatId}`    },
  ]]);
}

async function handleStart(chatId: string, firstName?: string, username?: string): Promise<void> {
  // Verifica se é usuário novo ANTES de salvar — evita notificar admin novamente
  const existingUser = await userService.getUserInfo(chatId);
  const isNewUser = existingUser === null;

  await userService.saveUser(chatId, firstName, username);

  // Admin é sempre autorizado automaticamente
  if (chatId === config.telegram.chatId) {
    const db = getDb();
    await db.execute({ sql: "UPDATE users SET is_authorized = 1 WHERE chat_id = ?", args: [chatId] });
    await sendReply(
      chatId,
      "👋 Olá, Administrador! Você está autorizado.\n\n" +
      "Comandos:\n" +
      "/status — Ver configuração\n" +
      "/buscar — Veja opções detalhadas de busca rápida\n" +
      "/perguntar BSB GRU vale a pena comprar agora?\n" +
      "/alerta ORIGEM DESTINO DATA PRECO\n" +
      "/meusalertas — Lista alertas\n" +
      "/noticias — Ligar ou desligar ofertas\n" +
      "/assinatura — Ver status da assinatura\n" +
      "/autorizar ID — Autoriza novo usuário\n" +
      "/ativar ID DIAS — Libera assinatura manual\n" +
      "/cancelar ID — Cancela assinatura manual"
    );
    return;
  }

  // Já autorizado
  if (existingUser?.is_authorized === 1) {
    await sendReply(chatId, `👋 Olá ${firstName}! Você está autorizado.\n\nComandos:\n/alerta - Monitorar passagens\n/perguntar - Concierge de IA com histórico real\n/meusalertas - Gerenciar alertas\n/assinatura - Ver seu acesso\n/noticias - Ligar/desligar ofertas\n/cpm - Calcular centavo por milha (CPM)`);
    return;
  }

  // Acesso recusado
  if (existingUser?.is_authorized === -1) {
    await sendReply(chatId, `❌ Olá ${firstName}. Infelizmente seu acesso foi negado.`);
    return;
  }

  // Pendente de aprovação — avisa o usuário
  await sendReply(
    chatId,
    `👋 Olá ${firstName}!\n\n` +
    `Seu acesso está *pendente de aprovação*.\n` +
    `Você receberá uma mensagem assim que o administrador liberar o seu acesso.`
  );

  // Notifica o admin UMA ÚNICA VEZ (apenas se usuário é realmente novo)
  if (isNewUser) {
    await notifyAdminNewUser(chatId, firstName, username);
  }
}

/**
 * Processa cliques nos botões inline de autorização/recusa.
 * Apenas o admin pode acionar esses botões.
 */
async function handleCallbackQuery(
  callbackQueryId: string,
  fromId: string,
  messageId: number | undefined,
  data: string
): Promise<void> {
  if (fromId !== config.telegram.chatId) {
    console.warn(`[webhook] callback_query de ID não-admin: recebido=${fromId}, esperado=${config.telegram.chatId}`);
    await answerCallbackQuery(callbackQueryId, "❌ Ação não permitida.");
    return;
  }

  const colonIdx = data.indexOf(":");
  const action   = data.slice(0, colonIdx);
  const targetId = data.slice(colonIdx + 1);

  if (!targetId || (action !== "authorize" && action !== "reject")) {
    await answerCallbackQuery(callbackQueryId, "❌ Dados inválidos.");
    return;
  }

  if (action === "authorize") {
    await userService.authorizeUser(targetId);
    await startTrialIfMissing(targetId);
    await answerCallbackQuery(callbackQueryId, "✅ Usuário autorizado!");
    await sendReply(
      targetId,
      "🎉 Seu acesso foi *aprovado*!\n\n" +
      "Seu *teste grátis de 7 dias* começou agora.\n\n" +
      "Use `/alerta ORIGEM DESTINO DATA PRECO` para começar a monitorar passagens.\nUse `/assinatura` para ver seu acesso."
    );
    if (messageId) {
      await editMessageText(
        config.telegram.chatId,
        messageId,
        `✅ *Usuário autorizado*\n🆔 ID: \`${targetId}\``
      );
    }
  } else {
    await userService.rejectUser(targetId);
    await answerCallbackQuery(callbackQueryId, "❌ Usuário recusado.");
    await sendReply(targetId, "❌ Seu acesso ao bot foi *negado*.");
    if (messageId) {
      await editMessageText(
        config.telegram.chatId,
        messageId,
        `❌ *Usuário recusado*\n🆔 ID: \`${targetId}\``
      );
    }
  }
}

async function handleAutorizar(adminId: string, targetId: string): Promise<void> {
  if (adminId !== config.telegram.chatId) {
    await sendReply(adminId, "❌ Comando restrito ao administrador.");
    return;
  }

  if (!targetId) {
    await sendReply(adminId, "❌ Formato inválido.\nUse: `/autorizar ID`");
    return;
  }

  await userService.authorizeUser(targetId);
  await startTrialIfMissing(targetId);
  await sendReply(adminId, `✅ Usuário \`${targetId}\` autorizado com sucesso!`);
  await sendReply(targetId, "🎉 Você acaba de ser *autorizado*.\n\nSeu *teste grátis de 7 dias* começou agora.\nUse `/alerta ORIGEM DESTINO DATA PRECO` para começar.\nUse `/assinatura` para ver seu acesso.");
}

async function handleAtivar(adminId: string, args: string[]): Promise<void> {
  if (adminId !== config.telegram.chatId) {
    await sendReply(adminId, "❌ Comando restrito ao administrador.");
    return;
  }

  const targetId = args[0];
  const days = args[1] ? Number(args[1]) : 30;
  if (!targetId || !Number.isFinite(days) || days <= 0) {
    await sendReply(adminId, "❌ Formato inválido.\nUse: `/ativar ID DIAS`\nEx: `/ativar 123456789 30`");
    return;
  }

  const normalizedDays = Math.floor(days);
  await activateSubscription(targetId, normalizedDays);
  await sendReply(adminId, `✅ Assinatura de \`${targetId}\` ativada por *${normalizedDays} dia(s)*.`);
  await sendReply(targetId, `✅ Sua assinatura foi ativada por *${normalizedDays} dia(s)*.`);
}

async function handleCancelar(adminId: string, targetId: string): Promise<void> {
  if (adminId !== config.telegram.chatId) {
    await sendReply(adminId, "❌ Comando restrito ao administrador.");
    return;
  }

  if (!targetId) {
    await sendReply(adminId, "❌ Formato inválido.\nUse: `/cancelar ID`");
    return;
  }

  await cancelSubscription(targetId);
  await sendReply(adminId, `🚫 Assinatura de \`${targetId}\` cancelada.`);
  await sendReply(targetId, "🚫 Sua assinatura foi cancelada.");
}

function parseBRDate(raw: string): string | null {
  const normalized = raw.includes("/") ? raw.split("/").reverse().join("-") : raw;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
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

  return normalized;
}

function isBeforeToday(isoDate: string): boolean {
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) < todayUTC;
}

function isAfterDate(a: string, b: string): boolean {
  return new Date(`${a}T00:00:00Z`).getTime() > new Date(`${b}T00:00:00Z`).getTime();
}

function parsePrice(raw: string): number {
  const cleaned = raw
    .trim()
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/[^\d.,]/g, "");

  if (!cleaned) return NaN;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;

  return Number(normalized);
}

async function handleNovoAlerta(chatId: string, args: string[]): Promise<void> {
  if (args.length !== 4 && args.length !== 5) {
    await sendReply(chatId, "❌ Formato inválido.\nUse: `/alerta ORIGEM DESTINO DATA PRECO`\nEx: `/alerta BSB GRU 20/07/2026 350`\n\n(Ida e volta: `/alerta BSB GRU 10/10/2026 20/10/2026 800`)");
    return;
  }

  const origin      = args[0].toUpperCase();
  const destination = args[1].toUpperCase();
  const isRoundTrip = args.length === 5;

  const departureDate = parseBRDate(args[2]);
  const returnDate    = isRoundTrip ? parseBRDate(args[3]) : undefined;
  const priceStr    = isRoundTrip ? args[4] : args[3];

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
    await sendReply(chatId, "❌ Origem e destino devem ser códigos IATA de 3 letras.\nEx: `BSB GRU`");
    return;
  }

  if (origin === destination) {
    await sendReply(chatId, "❌ Origem e destino precisam ser diferentes.");
    return;
  }

  if (!departureDate || (isRoundTrip && !returnDate)) {
    await sendReply(chatId, "❌ Data inválida.\nUse `DD/MM/AAAA` ou `AAAA-MM-DD`.");
    return;
  }

  if (isBeforeToday(departureDate)) {
    await sendReply(chatId, "❌ A data de ida precisa ser hoje ou uma data futura.");
    return;
  }

  if (returnDate && !isAfterDate(returnDate, departureDate)) {
    await sendReply(chatId, "❌ A data de volta precisa ser depois da data de ida.");
    return;
  }

  const maxPrice = parsePrice(priceStr);

  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    await sendReply(chatId, "❌ Preço inválido. Informe um valor positivo.\nEx: `/alerta BSB GRU 20/07/2026 350`");
    return;
  }

  await userService.addAlert({
    chat_id: chatId,
    origin,
    destination,
    departure_date: departureDate,
    return_date: returnDate ?? undefined,
    trip_type: isRoundTrip ? "round-trip" : "one-way",
    max_price_brl: maxPrice,
    is_active: true,
  });

  await sendReply(
    chatId,
    `✅ Alerta criado!\n\n` +
    `🛫 ${origin} → ${destination}\n` +
    `📅 Ida: ${departureDate}${returnDate ? `\n📅 Volta: ${returnDate}` : ""}\n` +
    `💰 Quando o preço for ≤ *${formatBRL(maxPrice)}* eu te aviso!`
  );
}

async function handleMeusAlertas(chatId: string): Promise<void> {
  const alerts = await userService.listUserAlerts(chatId);
  if (alerts.length === 0) {
    await sendReply(chatId, "📭 Você não possui alertas ativos.");
    return;
  }

  const lines = ["📋 *Seus Alertas Ativos:*", ""];
  for (const a of alerts) {
    lines.push(`🛫 *${a.origin} → ${a.destination}*`);
    lines.push(`📅 ${a.departure_date}${a.return_date ? ` (Volta: ${a.return_date})` : ""}`);
    lines.push(`💰 Limite: *${formatBRL(a.max_price_brl)}*`);
    lines.push(`🗑️ \`/remover ${a.id}\` | ✏️ \`/editar ${a.id} NOVO_PREÇO\``);
    lines.push("");
  }

  await sendReply(chatId, lines.join("\n"));
}

async function handleEditarAlerta(chatId: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    await sendReply(chatId, "❌ Formato inválido.\nUse: `/editar ID NOVO_PREÇO`\nEx: `/editar 5 450`");
    return;
  }

  const id       = parseInt(args[0]);
  const newPrice = parseFloat(args[1].replace(/[^0-9.]/g, ""));

  if (isNaN(id) || isNaN(newPrice)) {
    await sendReply(chatId, "❌ ID ou Preço inválidos.");
    return;
  }

  const ok = await userService.updateAlertPrice(chatId, id, newPrice);
  await sendReply(
    chatId,
    ok
      ? `✅ Alerta *${id}* atualizado para *${formatBRL(newPrice)}*!`
      : "❌ Alerta não encontrado ou não pertence a você."
  );
}

async function handleTendencia(chatId: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    await sendReply(chatId, "❌ Formato: `/tendencia ORIGEM DESTINO [DATA]`\nEx: `/tendencia BSB GRU 20/07/2026`");
    return;
  }

  const origin = args[0].toUpperCase();
  const destination = args[1].toUpperCase();
  const route = `${origin} → ${destination}`;

  // Parse optional departure date (3rd arg)
  let departureDate: string | undefined;
  if (args[2]) {
    const raw = args[2];
    const normalized = raw.includes("/") ? raw.split("/").reverse().join("-") : raw;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) {
      await sendReply(chatId, "❌ Data inválida. Use `DD/MM/AAAA` ou `AAAA-MM-DD`.");
      return;
    }
    departureDate = normalized;
  }

  await sendReply(chatId, `🔍 Analisando tendência de *${route}*...`);

  // If no date given, default to the most recently tracked departure date for this route
  if (!departureDate) {
    departureDate = (await getLatestDepartureDate(origin, destination)) ?? undefined;
  }

  const priceData = await getRoutePriceHistory(origin, destination, departureDate);

  if (priceData.length < 2) {
    const hint = departureDate
      ? `para a data *${departureDate}*`
      : "para essa rota";
    await sendReply(
      chatId,
      `📊 *${route}*\n\nSem dados suficientes ${hint}.\n` +
      `O tracker precisa de pelo menos 2 registros.\n` +
      `Tente: \`/tendencia ${origin} ${destination} 20/07/2026\``
    );
    return;
  }

  const trend = calcTrend(priceData, 7);
  const bestDay = bestDayOfWeek(priceData);
  const lowestEver = await getRouteLowestPrice(origin, destination, departureDate);
  const latestPrice = priceData[priceData.length - 1][1];
  const dateLabel = departureDate
    ? ` — data ${departureDate.split("-").reverse().join("/")}`
    : "";

  const lines = [`📈 *Tendência ${route}*${dateLabel} (últimos 7 dias)`, ""];

  if (trend) {
    const emoji = trend.direction === "down" ? "📉" : trend.direction === "up" ? "📈" : "➡️";
    const label = trend.direction === "down"
      ? `Queda de ${trend.pct}%`
      : trend.direction === "up"
        ? `Alta de +${trend.pct}%`
        : "Estável";
    lines.push(`📊 Direção: ${emoji} ${label}`);
  } else {
    lines.push(`📊 Direção: ➡️ Sem dados suficientes na última semana`);
  }

  lines.push(`💰 Último preço: *${formatBRL(latestPrice)}*`);
  if (lowestEver !== null) {
    lines.push(`🏆 Menor preço já registrado: *${formatBRL(lowestEver)}*`);
  }

  if (bestDay) {
    lines.push(`📅 Melhor dia para comprar: *${bestDay.dayName}* (média ${formatBRL(bestDay.avgPrice)})`);
  }

  lines.push("");
  if (trend) {
    if (trend.direction === "down" && trend.pct <= -5) {
      lines.push(`🔮 _Preços em queda significativa. Pode ser boa hora de comprar!_`);
    } else if (trend.direction === "down") {
      lines.push(`🔮 _Leve tendência de queda. Vale acompanhar._`);
    } else if (trend.direction === "up" && trend.pct >= 10) {
      lines.push(`🔮 _Preços subindo forte. Considere comprar logo ou esperar uma correção._`);
    } else if (trend.direction === "up") {
      lines.push(`🔮 _Preços em leve alta. Fique atento._`);
    } else {
      lines.push(`🔮 _Preços estáveis. Bom momento para monitorar._`);
    }
  } else {
    lines.push(`🔮 _Continue monitorando — mais dados gerarão insights melhores._`);
  }

  lines.push("", `_Baseado em ${priceData.length} registro(s)._`);

  // Limita o histórico aos últimos 30 registros para manter o gráfico limpo e legível
  const limitedPriceData = priceData.slice(-30);

  // Formata os rótulos do eixo X (DD/MM) e dados do eixo Y (preço)
  const labels = limitedPriceData.map(([ts]) => {
    const d = new Date(ts * 1000);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
  });
  const prices = limitedPriceData.map(([, price]) => price);

  // Configuração Chart.js em formato premium dark slate
  const chartConfig = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Preço (R$)",
          data: prices,
          fill: true,
          backgroundColor: "rgba(99, 102, 241, 0.12)", // Indigo translúcido
          borderColor: "#6366f1", // Indigo vibrante
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: "#6366f1",
          pointBorderColor: "#ffffff",
          lineTension: 0.4,
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: `Evolução de Preço: ${origin} -> ${destination}`,
        fontColor: "#f8fafc",
        fontSize: 16,
        fontFamily: "Inter, sans-serif",
      },
      legend: {
        display: false,
      },
      scales: {
        xAxes: [
          {
            gridLines: {
              color: "rgba(255, 255, 255, 0.08)",
            },
            ticks: {
              fontColor: "#94a3b8",
              fontFamily: "Inter, sans-serif",
            },
          },
        ],
        yAxes: [
          {
            gridLines: {
              color: "rgba(255, 255, 255, 0.08)",
            },
            ticks: {
              fontColor: "#94a3b8",
              fontFamily: "Inter, sans-serif",
            },
          },
        ],
      },
    },
  };

  // URL do QuickChart.io formatada (largura 500, altura 300, fundo slate-800 #1e293b)
  const quickChartUrl = `https://quickchart.io/chart?w=500&h=300&bkg=1e293b&c=${encodeURIComponent(
    JSON.stringify(chartConfig)
  )}`;

  const caption = lines.join("\n");
  if (caption.length > 1024) {
    // Se o texto exceder 1024 caracteres, envia a foto isolada e depois o texto
    await sendPhotoReply(chatId, quickChartUrl);
    await sendReply(chatId, caption);
  } else {
    // Envia tudo em um único balão integrado (gráfico + legenda)
    await sendPhotoReply(chatId, quickChartUrl, caption);
  }
}

async function handlePerguntar(chatId: string, args: string[]): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    await sendReply(
      chatId,
      "❌ Formato: `/perguntar BSB GRU vale a pena comprar agora?`\n\nTambém funciona com: `/perguntar Vale a pena comprar BSB→GRU agora?`"
    );
    return;
  }

  const usage = await canAskAI(chatId);
  if (!usage.allowed) {
    await sendReply(
      chatId,
      `⏳ Você atingiu o limite de *${usage.limit} pergunta(s)* ao concierge nas últimas 24h.\n\nTente novamente mais tarde ou use \`/tendencia ORIGEM DESTINO\` para uma análise sem IA.`
    );
    return;
  }

  await sendReply(chatId, "🤖 Analisando seu histórico e preparando uma recomendação...");
  try {
    const answer = await answerTravelQuestion(question);
    await recordAIQuery(chatId, question, true);
    await sendReply(chatId, answer);
  } catch (err) {
    await recordAIQuery(chatId, question, false);
    throw err;
  }
}

async function handleCPM(chatId: string, args: string[]): Promise<void> {
  if (args.length < 3) {
    await sendReply(
      chatId,
      "❌ Formato: `/cpm ORIGEM DESTINO MILHAS [PRECO_CASH]`\n\n" +
      "Exemplos:\n" +
      "`/cpm BSB GRU 18000` — busca preço ao vivo e calcula CPM\n" +
      "`/cpm BSB GRU 18000 350` — calcula CPM com preço informado"
    );
    return;
  }

  const origin = args[0].toUpperCase();
  const destination = args[1].toUpperCase();
  const miles = parseInt(args[2].replace(/[^\d]/g, ""), 10);

  if (isNaN(miles) || miles <= 0) {
    await sendReply(chatId, "❌ Quantidade de milhas inválida.");
    return;
  }

  const searchDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().split("T")[0];
  })();

  let cashBRL: number;
  let usedLiveSearch = false;

  if (args[3]) {
    const parsed = parseFloat(args[3].replace(/[^\d.,]/g, "").replace(",", "."));
    if (isNaN(parsed) || parsed <= 0) {
      await sendReply(chatId, "❌ Preço cash inválido.");
      return;
    }
    cashBRL = parsed;
  } else {
    // Check cache first (shared with /perguntar)
    const cached = getCached(origin, destination, searchDate);
    if (cached) {
      cashBRL = cached.bestFlight.priceBRL;
      usedLiveSearch = true;
    } else {
      await sendReply(chatId, `🔍 Buscando preço ao vivo para *${origin} → ${destination}*...`);
      const params = {
        origin,
        destination,
        departureDate: searchDate,
        tripType: "one-way" as const,
        ignoreMaxPrice: true,
      };
      let flights;
      try {
        flights = await searchWithApify(params);
      } catch {
        try {
          flights = await searchWithRapidAPI(params);
        } catch {
          await sendReply(chatId, "❌ Não consegui obter o preço ao vivo. Informe o preço cash manualmente:\n`/cpm BSB GRU 18000 350`");
          return;
        }
      }
      if (!flights || flights.length === 0) {
        await sendReply(chatId, "❌ Nenhum voo encontrado. Informe o preço cash manualmente:\n`/cpm BSB GRU 18000 350`");
        return;
      }
      cashBRL = Math.min(...flights.map(f => f.priceBRL));
      // Store in cache so subsequent /perguntar for same route uses this result
      const bestFlight = [...flights].sort((a, b) => a.priceBRL - b.priceBRL)[0];
      setCached(origin, destination, searchDate, {
        searchDate,
        usedDefaultDate: true,
        totalFound: flights.length,
        bestFlight,
      });
      usedLiveSearch = true;
    }
  }

  const cpm = calcCPM(cashBRL, miles);
  if (cpm === null) {
    await sendReply(chatId, "❌ Dados inválidos para calcular CPM.");
    return;
  }

  const dateNote = usedLiveSearch
    ? `_Preço cash: menor tarifa encontrada para ${searchDate} (data estimada)._\n\n`
    : "";
  await sendReply(chatId, `${dateNote}📊 *CPM — ${origin} → ${destination}*\n\n` + buildCPMRecommendation(cashBRL, miles, cpm));
}

async function handleAssinatura(chatId: string): Promise<void> {
  const access = await getSubscriptionAccess(chatId);
  await sendReply(
    chatId,
    `${formatSubscriptionStatus(access)}\n\n` +
    "Quando o período acabar, os comandos de busca, alerta e concierge ficam pausados até a renovação."
  );
}

async function ensurePaidAccess(chatId: string, cmd: string): Promise<boolean> {
  if (chatId === config.telegram.chatId) return true;

  const freeCommands = new Set(["/assinatura", "/noticias", "/ofertas", "/autorizar", "/ativar", "/cancelar", "/status"]);
  if (freeCommands.has(cmd)) return true;

  const access = await getSubscriptionAccess(chatId);
  if (access.hasAccess) return true;

  await sendReply(
    chatId,
    `${formatSubscriptionStatus(access)}\n\n` +
    "Para continuar usando o bot, renove sua assinatura. " +
    "Enquanto isso, use `/assinatura` para consultar seu status."
  );
  return false;
}

// ── Dispatcher principal ────────────────────────────────────────────────────

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // Botões inline (callback_query)
  if (update.callback_query) {
    const cq = update.callback_query;
    await handleCallbackQuery(
      cq.id,
      String(cq.from.id),
      cq.message?.message_id,
      cq.data ?? ""
    );
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  // Bot é estritamente privado — ignora grupos, supergrupos e canais
  if (msg.chat.type !== "private") return;

  const chatId    = String(msg.chat.id);
  const firstName = msg.from?.first_name;
  const username  = msg.from?.username;
  const text      = msg.text.trim();

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  // /start e /meuid são sempre públicos
  if (cmd === "/start") {
    await handleStart(chatId, firstName, username);
    return;
  }

  if (cmd === "/meuid") {
    await sendReply(chatId, `🆔 Seu ID do Telegram: \`${chatId}\`\n\nSe você é o administrador, confirme que \`TELEGRAM_CHAT_ID\` no Railway está igual a este número.`);
    return;
  }

  // Demais comandos exigem autorização
  const authorized = await userService.isUserAuthorized(chatId);
  if (!authorized) {
    await sendReply(chatId, "❌ Acesso negado. Aguarde a autorização do administrador.");
    return;
  }

  const hasPaidAccess = await ensurePaidAccess(chatId, cmd);
  if (!hasPaidAccess) return;

  try {
    if (cmd === "/alerta") {
      await handleNovoAlerta(chatId, args);
    } else if (cmd === "/meusalertas") {
      await handleMeusAlertas(chatId);
    } else if (cmd === "/remover") {
      const id = parseInt(args[0]);
      if (isNaN(id)) {
        await sendReply(chatId, "❌ Informe o ID numérico do alerta. Verifique em `/meusalertas`.");
      } else {
        const ok = await userService.removeAlert(chatId, id);
        await sendReply(chatId, ok ? `🗑️ Alerta *${id}* removido com sucesso.` : "❌ Alerta não encontrado ou não pertence a você.");
      }
    } else if (cmd === "/editar") {
      await handleEditarAlerta(chatId, args);
    } else if (cmd === "/noticias" || cmd === "/ofertas") {
      const isNowEnabled = await userService.toggleNewsPreference(chatId);
      if (isNowEnabled) {
        await sendReply(chatId, "✅ *Notícias e Ofertas ativadas!*\nVocê passará a receber novidades sobre milhas, cartões e passagens.");
      } else {
        await sendReply(chatId, "🔕 *Notícias e Ofertas silenciadas.*\nVocê não receberá mais notificações avulsas (seus alertas de voos continuam funcionando).");
      }
    } else if (cmd === "/autorizar") {
      await handleAutorizar(chatId, args[0]);
    } else if (cmd === "/ativar") {
      await handleAtivar(chatId, args);
    } else if (cmd === "/cancelar") {
      await handleCancelar(chatId, args[0]);
    } else if (cmd === "/assinatura") {
      await handleAssinatura(chatId);
    } else if (cmd === "/status") {
      if (chatId !== config.telegram.chatId) {
        await sendReply(chatId, "❌ Comando restrito ao administrador.");
        return;
      }
      const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      await sendReply(chatId, `✅ *Status Admin*\n🕐 ${now}\n🛫 Origem padrão: ${config.search.origin}\n🚀 Servidor Railway Ativo`);
    } else if (cmd === "/buscar") {
      const { handleBuscar } = await import("./webhook_legacy");
      await handleBuscar(parseInt(chatId), args);
    } else if (cmd === "/tendencia") {
      await handleTendencia(chatId, args);
    } else if (cmd === "/perguntar") {
      await handlePerguntar(chatId, args);
    } else if (cmd === "/cpm") {
      await handleCPM(chatId, args);
    }
  } catch (err) {
    console.error(`[webhook] Erro no comando ${cmd}:`, err);
    await sendReply(chatId, "❌ Erro ao processar comando.");
  }
}

// ── Servidor HTTP ───────────────────────────────────────────────────────────

export let botUsername = "";

export async function fetchBotUsername(): Promise<string> {
  if (botUsername) return botUsername;
  try {
    const res = await axios.get<{ ok: boolean; result: { username: string } }>(`${BASE_URL}/getMe`);
    if (res.data?.ok && res.data?.result?.username) {
      botUsername = res.data.result.username;
      console.log(`[webhook] Bot username carregado: @${botUsername}`);
    }
  } catch (err) {
    console.error("[webhook] Erro ao carregar username do bot:", err instanceof Error ? err.message : err);
  }
  return botUsername;
}

export function verifyTelegramHash(params: Record<string, string>, botToken: string): boolean {
  if (!params.hash) return false;
  const hash = params.hash;
  const data = { ...params };
  delete data.hash;

  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return calculatedHash === hash;
}

export function createSessionToken(id: string, firstName: string, username: string, botToken: string): string {
  const timestamp = Date.now().toString();
  const rawData = [id, firstName, username, timestamp].map(encodeURIComponent).join(":");
  const hmac = crypto.createHmac("sha256", botToken).update(rawData).digest("hex");
  return `${rawData}:${hmac}`;
}

export function verifySessionToken(token: string, botToken: string): { id: string; firstName: string; username: string } | null {
  try {
    const parts = token.split(":");
    if (parts.length !== 5) return null;
    const [id, firstName, username, timestamp, signature] = parts;
    const rawData = [id, firstName, username, timestamp].join(":");
    const expectedHmac = crypto.createHmac("sha256", botToken).update(rawData).digest("hex");
    if (signature !== expectedHmac) return null;

    const age = Date.now() - Number(timestamp);
    if (age > 30 * 24 * 60 * 60 * 1000) return null;

    return {
      id: decodeURIComponent(id),
      firstName: decodeURIComponent(firstName),
      username: decodeURIComponent(username),
    };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc, cookie) => {
    const [key, ...value] = cookie.trim().split("=");
    if (key) acc[key.trim()] = value.join("=").trim();
    return acc;
  }, {} as Record<string, string>);
}

export function startWebhookServer(): http.Server {
  // Busca o username do bot em segundo plano
  fetchBotUsername().catch(console.error);

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url ?? "", `http://${req.headers.host || "localhost"}`);
    const pathname = urlObj.pathname;
    const method = req.method;

    const sendJSON = (statusCode: number, data: any, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(statusCode, { "Content-Type": "application/json", ...extraHeaders });
      res.end(JSON.stringify(data));
    };

    // ── ENDPOINTS DE API ──

    if (method === "GET" && pathname === "/api/stats") {
      (async () => {
        try {
          const db = getDb();
          
          const historyCountRes = await db.execute("SELECT COUNT(*) as n FROM history");
          const totalChecks = Number(historyCountRes.rows[0]?.n ?? 0);

          const lowestPriceRes = await db.execute("SELECT MIN(cheapestPriceBRL) as minPrice FROM history WHERE cheapestPriceBRL IS NOT NULL");
          const lowestPrice = lowestPriceRes.rows[0]?.minPrice !== null && lowestPriceRes.rows[0]?.minPrice !== undefined ? Number(lowestPriceRes.rows[0].minPrice) : null;

          const routesCountRes = await db.execute("SELECT COUNT(DISTINCT(origin || '->' || destination)) as n FROM history");
          const routesCount = Number(routesCountRes.rows[0]?.n ?? 0);

          const activeUsersCountRes = await db.execute("SELECT COUNT(*) as n FROM users WHERE is_authorized = 1");
          const activeUsersCount = Number(activeUsersCountRes.rows[0]?.n ?? 0);

          const currentBotUser = await fetchBotUsername();
          const lastUpdate = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

          sendJSON(200, {
            ok: true,
            totalChecks,
            lowestPrice,
            routesCount,
            activeUsersCount,
            botUsername: currentBotUser,
            lastUpdate
          });
        } catch (err) {
          console.error("[api] Erro ao buscar stats:", err);
          sendJSON(500, { ok: false, message: "Erro interno ao buscar estatísticas." });
        }
      })();
      return;
    }

    if (method === "GET" && pathname === "/api/history") {
      (async () => {
        try {
          const history = await getFullHistory();
          sendJSON(200, { ok: true, history });
        } catch (err) {
          console.error("[api] Erro ao buscar histórico:", err);
          sendJSON(500, { ok: false, message: "Erro interno ao buscar histórico." });
        }
      })();
      return;
    }

    if (method === "GET" && pathname === "/api/auth/telegram") {
      const params: Record<string, string> = {};
      urlObj.searchParams.forEach((val, key) => {
        params[key] = val;
      });

      if (!verifyTelegramHash(params, config.telegram.botToken)) {
        res.writeHead(302, { "Location": "/dashboard?auth_error=signature" });
        res.end();
        return;
      }

      const authDate = Number(params.auth_date);
      if (isNaN(authDate) || Date.now() / 1000 - authDate > 86400) {
        res.writeHead(302, { "Location": "/dashboard?auth_error=expired" });
        res.end();
        return;
      }

      const sessionToken = createSessionToken(
        params.id,
        params.first_name || "",
        params.username || "",
        config.telegram.botToken
      );

      const cookieVal = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`; // 30 dias
      res.writeHead(302, {
        "Set-Cookie": cookieVal,
        "Location": "/dashboard"
      });
      res.end();
      return;
    }

    if (method === "GET" && pathname === "/api/auth/logout") {
      const cookieVal = `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
      sendJSON(200, { ok: true }, { "Set-Cookie": cookieVal });
      return;
    }

    if (method === "GET" && pathname === "/api/alerts") {
      (async () => {
        const cookies = parseCookies(req.headers.cookie);
        const session = cookies.session;
        if (!session) {
          sendJSON(401, { ok: false, message: "Não autorizado." });
          return;
        }

        const user = verifySessionToken(session, config.telegram.botToken);
        if (!user) {
          sendJSON(401, { ok: false, message: "Sessão inválida." });
          return;
        }

        const authorized = await userService.isUserAuthorized(user.id);
        if (!authorized) {
          sendJSON(403, { ok: false, message: "Não autorizado." });
          return;
        }

        const alerts = await userService.listUserAlerts(user.id);
        sendJSON(200, { ok: true, alerts, user });
      })();
      return;
    }

    if (method === "POST" && pathname === "/api/alerts") {
      (async () => {
        const cookies = parseCookies(req.headers.cookie);
        const session = cookies.session;
        if (!session) {
          sendJSON(401, { ok: false, message: "Não autorizado." });
          return;
        }

        const user = verifySessionToken(session, config.telegram.botToken);
        if (!user) {
          sendJSON(401, { ok: false, message: "Sessão inválida." });
          return;
        }

        const authorized = await userService.isUserAuthorized(user.id);
        if (!authorized) {
          sendJSON(403, { ok: false, message: "Não autorizado." });
          return;
        }

        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => {
          (async () => {
            try {
              const payload = JSON.parse(body);
              const { origin, destination, departureDate, returnDate, tripType, maxPriceBRL } = payload;

              if (!origin || !destination || !departureDate || !tripType || isNaN(Number(maxPriceBRL))) {
                sendJSON(400, { ok: false, message: "Campos obrigatórios ausentes ou inválidos." });
                return;
              }

              const uOrigin = origin.toUpperCase();
              const uDestination = destination.toUpperCase();
              if (!/^[A-Z]{3}$/.test(uOrigin) || !/^[A-Z]{3}$/.test(uDestination)) {
                sendJSON(400, { ok: false, message: "Origem e destino devem ser códigos de 3 letras." });
                return;
              }

              if (uOrigin === uDestination) {
                sendJSON(400, { ok: false, message: "Origem e destino devem ser diferentes." });
                return;
              }

              const parsedPrice = Number(maxPriceBRL);
              if (parsedPrice <= 0) {
                sendJSON(400, { ok: false, message: "Preço máximo deve ser maior que zero." });
                return;
              }

              const alertId = await userService.addAlert({
                chat_id: user.id,
                origin: uOrigin,
                destination: uDestination,
                departure_date: departureDate,
                return_date: returnDate || undefined,
                trip_type: tripType,
                max_price_brl: parsedPrice,
                is_active: true,
              });

              sendJSON(200, { ok: true, alertId, message: "Alerta criado com sucesso!" });
            } catch {
              sendJSON(400, { ok: false, message: "Corpo JSON inválido." });
            }
          })();
        });
      })();
      return;
    }

    if (method === "POST" && pathname === "/api/alerts/update") {
      (async () => {
        const cookies = parseCookies(req.headers.cookie);
        const session = cookies.session;
        if (!session) {
          sendJSON(401, { ok: false, message: "Não autorizado." });
          return;
        }

        const user = verifySessionToken(session, config.telegram.botToken);
        if (!user) {
          sendJSON(401, { ok: false, message: "Sessão inválida." });
          return;
        }

        const authorized = await userService.isUserAuthorized(user.id);
        if (!authorized) {
          sendJSON(403, { ok: false, message: "Não autorizado." });
          return;
        }

        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => {
          (async () => {
            try {
              const payload = JSON.parse(body);
              const { id, maxPriceBRL } = payload;
              const alertId = Number(id);
              const newPrice = Number(maxPriceBRL);

              if (isNaN(alertId) || isNaN(newPrice) || newPrice <= 0) {
                sendJSON(400, { ok: false, message: "Parâmetros inválidos." });
                return;
              }

              const success = await userService.updateAlertPrice(user.id, alertId, newPrice);
              if (success) {
                sendJSON(200, { ok: true, message: "Alerta atualizado com sucesso!" });
              } else {
                sendJSON(404, { ok: false, message: "Alerta não encontrado ou não pertence a você." });
              }
            } catch {
              sendJSON(400, { ok: false, message: "Corpo JSON inválido." });
            }
          })();
        });
      })();
      return;
    }

    if (method === "DELETE" && pathname === "/api/alerts") {
      (async () => {
        const cookies = parseCookies(req.headers.cookie);
        const session = cookies.session;
        if (!session) {
          sendJSON(401, { ok: false, message: "Não autorizado." });
          return;
        }

        const user = verifySessionToken(session, config.telegram.botToken);
        if (!user) {
          sendJSON(401, { ok: false, message: "Sessão inválida." });
          return;
        }

        const authorized = await userService.isUserAuthorized(user.id);
        if (!authorized) {
          sendJSON(403, { ok: false, message: "Não autorizado." });
          return;
        }

        const alertId = Number(urlObj.searchParams.get("id"));
        if (isNaN(alertId) || alertId <= 0) {
          sendJSON(400, { ok: false, message: "ID do alerta inválido." });
          return;
        }

        const success = await userService.removeAlert(user.id, alertId);
        if (success) {
          sendJSON(200, { ok: true, message: "Alerta removido com sucesso." });
        } else {
          sendJSON(404, { ok: false, message: "Alerta não encontrado ou não pertence a você." });
        }
      })();
      return;
    }

    // ── ARQUIVOS ESTÁTICOS ──

    if (method === "GET" && pathname === "/") {
      (async () => {
        try {
          const filePath = path.join(process.cwd(), "landing", "index.html");
          const html = await fs.promises.readFile(filePath, "utf8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        } catch {
          res.writeHead(500);
          res.end("Erro ao carregar a página principal.");
        }
      })();
      return;
    }

    if (method === "GET" && pathname === "/dashboard") {
      (async () => {
        try {
          const filePath = path.join(process.cwd(), "landing", "dashboard.html");
          const html = await fs.promises.readFile(filePath, "utf8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        } catch {
          res.writeHead(500);
          res.end("Erro ao carregar o dashboard.");
        }
      })();
      return;
    }

    // ── WEBHOOK DO TELEGRAM (POST) & CAKTO ──

    if (method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", () => {
        if (pathname.startsWith("/webhooks/cakto")) {
          (async () => {
            const { handleCaktoWebhook } = await import("./caktoWebhook");
            const result = await handleCaktoWebhook(body, req.headers, req.url);
            res.writeHead(result.statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: result.ok, message: result.message }));
          })().catch((err) => {
            console.error("[webhook] Erro ao processar webhook Cakto:", err instanceof Error ? err.message : err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: "internal_error" }));
          });
          return;
        }

        res.writeHead(200);
        res.end("OK");

        if (!body) return;

        (async () => {
          try {
            const update: TelegramUpdate = JSON.parse(body);
            await handleUpdate(update);
          } catch (err) {
            console.error("[webhook] Erro ao processar update:", err instanceof Error ? err.message : err);
          }
        })();
      });
      return;
    }

    // Fallback
    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`[webhook] Servidor na porta ${WEBHOOK_PORT}`);
  });

  return server;
}
