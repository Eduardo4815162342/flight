"""Monitor de passagens sem API paga.

Usa a biblioteca open source fast-flights para consultar o Google Flights,
salva um pequeno histórico no repositório e envia alertas pelo Telegram.
"""

from __future__ import annotations

import json
import os
from html import escape
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests
from fast_flights import FlightQuery, Passengers, create_query, get_flights


ORIGINS = [x.strip() for x in os.getenv("FLIGHT_ORIGINS", "GRU,VCP").split(",") if x.strip()]
ARRIVAL_AIRPORTS = [x.strip() for x in os.getenv("FLIGHT_ARRIVAL_AIRPORTS", "MRS,NCE,LYS").split(",") if x.strip()]
RETURN_AIRPORTS = [x.strip() for x in os.getenv("FLIGHT_RETURN_AIRPORTS", "MRS,NCE,LYS").split(",") if x.strip()]
DEPARTURE_START = date.fromisoformat(os.getenv("FLIGHT_DEPARTURE_START", "2027-01-02"))
DEPARTURE_END = date.fromisoformat(os.getenv("FLIGHT_DEPARTURE_END", "2027-01-07"))
RETURN_START = date.fromisoformat(os.getenv("FLIGHT_RETURN_START", "2027-01-16"))
RETURN_END = date.fromisoformat(os.getenv("FLIGHT_RETURN_END", "2027-01-19"))
MAX_PRICE = float(os.getenv("FLIGHT_MAX_PRICE_BRL", "6000"))
MAX_STOPS = int(os.getenv("FLIGHT_MAX_STOPS", "2"))
MAX_DURATION_MINUTES = int(os.getenv("FLIGHT_MAX_DURATION_MINUTES", "1320"))
SEND_SUMMARY = os.getenv("FLIGHT_SEND_SUMMARY", "false").lower() == "true"
CITY_NAMES = {
    "MRS": "Marselha", "NCE": "Nice", "LYS": "Lyon", "BCN": "Barcelona",
    "MAD": "Madrid", "LIS": "Lisboa", "OPO": "Porto", "CDG": "Paris",
    "ORY": "Paris",
}
HISTORY_FILE = Path(os.getenv("FLIGHT_HISTORY_FILE", "data/free-flight-history.json"))
# Janeiro: Brasil fica em UTC-3 e os aeroportos europeus monitorados em UTC+1.
# A conversão é necessária para medir corretamente conexões e duração total.
UTC_OFFSETS = {
    "GRU": -3, "VCP": -3,
    "MRS": 1, "NCE": 1, "LYS": 1, "BCN": 1, "MAD": 1,
    "LIS": 0, "OPO": 0, "CDG": 1, "ORY": 1,
}


def values(start: date, end: date):
    current = start
    while current <= end:
        yield current.isoformat()
        current += timedelta(days=1)


def get_value(item: Any, *names: str, default: Any = None):
    if isinstance(item, dict):
        for name in names:
            if name in item:
                return item[name]
    for name in names:
        value = getattr(item, name, None)
        if value is not None:
            return value
    return default


def duration_minutes(segments: list[Any]) -> int | None:
    if not segments:
        return None
    first = segments[0]
    last = segments[-1]
    departure = get_value(first, "departure")
    arrival = get_value(last, "arrival")
    dep_date = get_value(departure, "date")
    dep_time = get_value(departure, "time")
    arr_date = get_value(arrival, "date")
    arr_time = get_value(arrival, "time")
    departure_airport = get_value(first, "from_airport")
    arrival_airport = get_value(last, "to_airport")
    departure_code = get_value(departure_airport, "code")
    arrival_code = get_value(arrival_airport, "code")
    if not all((dep_date, dep_time, arr_date, arr_time, departure_code, arrival_code)):
        return None
    try:
        start = date(*dep_date).toordinal() * 1440 + dep_time[0] * 60 + dep_time[1] - UTC_OFFSETS[departure_code] * 60
        end = date(*arr_date).toordinal() * 1440 + arr_time[0] * 60 + arr_time[1] - UTC_OFFSETS[arrival_code] * 60
        return max(0, end - start)
    except (KeyError, TypeError, IndexError, ValueError):
        return None


def search(origin: str, arrival: str, outbound: str, inbound: str) -> dict[str, Any] | None:
    query = create_query(
        flights=[
            FlightQuery(date=outbound, from_airport=origin, to_airport=arrival),
            FlightQuery(date=inbound, from_airport=arrival, to_airport=origin),
        ],
        trip="round-trip",
        seat="economy",
        passengers=Passengers(adults=1),
        language="pt-BR",
        currency="BRL",
    )
    result = get_flights(query)
    # fast-flights 3.x retorna um ResultList; versões anteriores podiam
    # encapsular os resultados em um atributo `flights`.
    flights = list(result) if isinstance(result, list) else (get_value(result, "flights", default=[]) or [])
    candidates = []
    for flight in flights:
        price = get_value(flight, "price", "price_brl", "total_price")
        if price is None:
            continue
        try:
            if isinstance(price, (int, float)):
                price = float(price)
            else:
                price = float(str(price).replace("R$", "").replace(".", "").replace(",", ".").strip())
        except ValueError:
            continue
        segments = get_value(flight, "flights", default=[]) or []
        # O resultado representa o trecho exibido pelo Google Flights:
        # segmentos - 1 é o número real de conexões desse trecho.
        stops = get_value(flight, "stops", "stops_count", default=max(0, len(segments) - 1))
        try:
            stops = int(stops)
        except (TypeError, ValueError):
            stops = 99
        duration = duration_minutes(segments)
        if stops <= MAX_STOPS and duration is not None and duration <= MAX_DURATION_MINUTES:
            candidates.append({
                # A moeda é solicitada explicitamente como BRL na query.
                "price": price,
                "stops": stops,
                "duration_minutes": duration,
                "airline": ", ".join(get_value(flight, "airlines", default=[])) or get_value(flight, "name", "airline", "airline_name", default="desconhecida"),
                "departure": get_value(flight, "departure", "departure_time", default=""),
                "arrival_time": get_value(flight, "arrival", "arrival_time", default=""),
                "link": get_value(flight, "link", "url", default=f"https://www.google.com/travel/flights?q=flights+from+{origin}+to+{arrival}+on+{outbound}"),
            })
    if not candidates:
        return None
    best = min(candidates, key=lambda x: x["price"])
    return {"origin": origin, "arrival": arrival, "outbound": outbound, "inbound": inbound, **best}


def load_history() -> dict[str, Any]:
    if not HISTORY_FILE.exists():
        return {}
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def send_telegram(message: str):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    response = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat_id, "text": message, "parse_mode": "HTML", "disable_web_page_preview": True}, timeout=30)
    if not response.ok:
        raise RuntimeError(f"Telegram HTTP {response.status_code}: {response.text}")


def format_brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def format_date(value: str) -> str:
    return date.fromisoformat(value).strftime("%d/%m")


def format_duration(minutes: int | None) -> str:
    if minutes is None:
        return "duração indisponível"
    hours, remainder = divmod(minutes, 60)
    return f"{hours}h{remainder:02d}"


def offer_signature(offer: dict[str, Any]) -> str:
    fields = (
        offer.get("origin"), offer.get("arrival"), offer.get("outbound"),
        offer.get("inbound"), offer.get("airline"), offer.get("price"),
        offer.get("stops"), offer.get("duration_minutes"),
    )
    return "|".join(str(value) for value in fields)


def cost_benefit_score(offer: dict[str, Any], candidates: list[dict[str, Any]]) -> float:
    """Índice menor = melhor equilíbrio entre preço e duração.

    Normaliza preço e tempo dentro das opções da mesma cidade para que as
    duas dimensões tenham peso equivalente.
    """
    prices = [item["price"] for item in candidates]
    durations = [item["duration_minutes"] for item in candidates]
    price_range = max(prices) - min(prices) or 1
    duration_range = max(durations) - min(durations) or 1
    price_score = (offer["price"] - min(prices)) / price_range
    duration_score = (offer["duration_minutes"] - min(durations)) / duration_range
    return (price_score + duration_score) / 2


def main():
    history = load_history()
    found = []
    for origin in ORIGINS:
        for arrival in ARRIVAL_AIRPORTS:
            for outbound in values(DEPARTURE_START, DEPARTURE_END):
                for inbound in values(RETURN_START, RETURN_END):
                    print(f"Consultando {origin}-{arrival} {outbound}/{inbound}")
                    try:
                        item = search(origin, arrival, outbound, inbound)
                    except Exception as exc:
                        print(f"Falha na consulta: {exc}")
                        continue
                    if item:
                        found.append(item)

    if not found:
        print("Nenhuma opção encontrada.")
        return
    # Seleciona a opção mais barata e a melhor relação custo-benefício por cidade.
    city_candidates: dict[str, list[dict[str, Any]]] = {}
    for item in found:
        city = CITY_NAMES.get(item["arrival"], item["arrival"])
        city_candidates.setdefault(city, []).append(item)
    selections = []
    for city, candidates in city_candidates.items():
        cheapest = min(candidates, key=lambda x: x["price"])
        best_value = min(candidates, key=lambda x: cost_benefit_score(x, candidates))
        selections.append((city, cheapest, best_value))
    selections.sort(key=lambda item: item[1]["price"])
    selected_items = [item for selection in selections for item in selection[1:]]
    report_signature = "||".join(offer_signature(item) for item in selected_items)
    previous_report_signature = history.get("_last_report_signature")
    history["_last_report_signature"] = report_signature
    for item in selected_items:
        key = f"{item['origin']}-{item['arrival']}-{item['outbound']}-{item['inbound']}"
        history[key] = {**item, "last_notified_signature": offer_signature(item)}
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")

    should_send = report_signature != previous_report_signature and (
        SEND_SUMMARY or any(item["price"] <= MAX_PRICE for item in selected_items)
    )
    if should_send:
        lines = ["✈️ <b>Melhores opções por destino</b>", ""]
        for city_name, cheapest, best_value in selections:
            city = escape(city_name)
            item = cheapest
            stops = item["stops"]
            stop_label = "parada" if stops == 1 else "paradas"
            lines.extend([
                f"━━━━━━━━━━━━━━━━━━\n<b>📍 {city}</b>\n\n"
                f"<b>💰 Mais barata</b>\n"
                f"{format_date(item['outbound'])} a {format_date(item['inbound'])} - "
                f"{escape(str(item['airline']))} - {stops} {stop_label} - {format_duration(item.get('duration_minutes'))} - "
                f"<b>{format_brl(item['price'])}</b>",
                f"<a href=\"{escape(str(item['link']), quote=True)}\">Abrir no Google Flights</a>",
                "",
            ])
            if offer_signature(best_value) != offer_signature(cheapest):
                stops = best_value["stops"]
                stop_label = "parada" if stops == 1 else "paradas"
                lines.extend([
                    f"<b>⚖️ Melhor custo-benefício</b>\n"
                    f"{format_date(best_value['outbound'])} a {format_date(best_value['inbound'])} - "
                    f"{escape(str(best_value['airline']))} - {stops} {stop_label} - {format_duration(best_value.get('duration_minutes'))} - "
                    f"<b>{format_brl(best_value['price'])}</b>",
                    f"<a href=\"{escape(str(best_value['link']), quote=True)}\">Abrir no Google Flights</a>",
                    "",
                ])
        message = "\n".join(lines).strip()
        send_telegram(message)
        history["_last_report_signature"] = report_signature
        HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Alerta enviado ao Telegram.")
    else:
        print("Relatório sem alterações relevantes; nenhum alerta necessário.")


if __name__ == "__main__":
    main()
