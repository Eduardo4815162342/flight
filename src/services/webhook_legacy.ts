import { config } from "../config";
import { SearchParams, Flight } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { formatBRL } from "./currency";
import { sendReply } from "./webhook";
import { generateDateRange } from "../utils/dateRange";

function parseBROrISODate(raw: string): string | null {
  const normalized = raw.includes("/") ? raw.split("/").reverse().join("-") : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

async function searchOneDate(
  origin: string,
  destination: string,
  depDate: string
): Promise<Flight[]> {
  const params: SearchParams = {
    origin,
    destination,
    departureDate: depDate,
    returnDate: undefined,
    tripType: "one-way",
    ignoreMaxPrice: true,
  };
  try {
    return await searchWithApify(params);
  } catch {
    try {
      return await searchWithRapidAPI(params);
    } catch {
      return [];
    }
  }
}

async function handleDateRange(
  chatId: number,
  origin: string,
  destination: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const dates = generateDateRange(startDate, endDate, 30);
  if (dates.length === 0) {
    await sendReply(chatId, "❌ Intervalo de datas inválido. A data de início precisa ser antes da data de fim.");
    return;
  }

  const requestedDays = Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000)
  ) + 1;
  const truncated = requestedDays > dates.length;

  await sendReply(
    chatId,
    `🔍 Buscando *${dates.length} dia(s)*...\n🛫 ${origin} → ${destination}\n📅 ${startDate} até ${endDate}` +
    (truncated ? `\n⚠️ _Limitado aos primeiros ${dates.length} dias do período de ${requestedDays} dias._` : "") +
    `\n\nAguarde, isso pode levar alguns segundos...`
  );

  const results: { date: string; priceBRL: number; airline?: string }[] = [];

  for (const date of dates) {
    const flights = await searchOneDate(origin, destination, date);
    if (flights.length > 0) {
      const best = [...flights].sort((a, b) => a.priceBRL - b.priceBRL)[0];
      results.push({ date, priceBRL: best.priceBRL, airline: best.airline });
    }
  }

  if (results.length === 0) {
    await sendReply(chatId, `✈️ Nenhum voo encontrado para ${origin} → ${destination} no período.`);
    return;
  }

  const sorted = results.sort((a, b) => a.priceBRL - b.priceBRL).slice(0, 5);
  const lines = [
    `✈️ *${origin} → ${destination}*`,
    `📋 *Dias mais baratos no período:*`,
    "",
  ];

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    lines.push(`${medal} *${r.date}* — ${formatBRL(r.priceBRL)}${r.airline ? ` (${r.airline})` : ""}`);
  }

  lines.push("", `_${results.length} dia(s) com resultados de ${dates.length} verificado(s)._`);
  await sendReply(chatId, lines.join("\n"));
}

export async function handleBuscar(chatId: number, args: string[]): Promise<void> {
  if (args.length === 0) {
    await sendReply(
      chatId,
      "❌ *Uso detalhado do comando /buscar:*\n\n" +
      "1️⃣ `/buscar DESTINO`\n_(Usa a origem padrão e a data configurada no sistema)_\n\n" +
      "2️⃣ `/buscar ORIGEM DESTINO`\n_(Usa a data configurada no sistema)_\n\n" +
      "3️⃣ `/buscar ORIGEM DESTINO DATA_IDA`\n_(Busca numa data específica. Ex: /buscar BSB GRU 20/07/2026)_\n\n" +
      "4️⃣ `/buscar ORIGEM DESTINO DATA_INICIO DATA_FIM`\n_(Dias mais baratos num período. Ex: /buscar BSB GRU 01/07/2026 31/07/2026)_"
    );
    return;
  }

  let origin = config.search.origin;
  let dest = "";
  let depDate = config.search.departureDate;

  if (args.length === 1) {
    dest = args[0].toUpperCase();
  } else if (args.length === 2) {
    origin = args[0].toUpperCase();
    dest = args[1].toUpperCase();
  } else if (args.length === 3) {
    origin = args[0].toUpperCase();
    dest = args[1].toUpperCase();
    const parsed = parseBROrISODate(args[2]);
    if (!parsed) {
      await sendReply(chatId, "❌ Data inválida. Use `DD/MM/AAAA` ou `AAAA-MM-DD`.");
      return;
    }
    depDate = parsed;
  } else if (args.length === 4) {
    origin = args[0].toUpperCase();
    dest = args[1].toUpperCase();
    const startDate = parseBROrISODate(args[2]);
    const endDate = parseBROrISODate(args[3]);
    if (!startDate || !endDate) {
      await sendReply(chatId, "❌ Datas inválidas. Use `DD/MM/AAAA` ou `AAAA-MM-DD`.");
      return;
    }
    await handleDateRange(chatId, origin, dest, startDate, endDate);
    return;
  } else {
    await sendReply(chatId, "❌ Muitos argumentos.\nUse: `/buscar ORIGEM DESTINO DATA_INICIO DATA_FIM`");
    return;
  }

  await sendReply(chatId, `🔍 Buscando voos...\n🛫 ${origin} → ${dest}\n📅 Data: ${depDate}\n\nAguarde, isso pode levar alguns segundos...`);

  const params: SearchParams = {
    origin,
    destination: dest,
    departureDate: depDate,
    returnDate: undefined,
    tripType: "one-way",
    ignoreMaxPrice: true,
  };

  let flights;
  try {
    flights = await searchWithApify(params);
  } catch {
    try {
      flights = await searchWithRapidAPI(params);
    } catch {
      await sendReply(chatId, `❌ Falha ao buscar voos ${origin} → ${dest}.`);
      return;
    }
  }

  if (flights.length === 0) {
    await sendReply(chatId, `✈️ Nenhum voo encontrado para ${origin} → ${dest}.`);
    return;
  }

  const sorted = [...flights].sort((a, b) => a.priceBRL - b.priceBRL).slice(0, 3);
  const lines = [
    `✈️ *${origin} → ${dest}*`,
    `📋 *Melhores preços agora:*`,
  ];

  for (const f of sorted) {
    lines.push(`• ${formatBRL(f.priceBRL)}${f.airline ? ` — ${f.airline}` : ""}`);
  }

  await sendReply(chatId, lines.join("\n"));
}
