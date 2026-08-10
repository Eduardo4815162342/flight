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
DEPARTURE_START = date.fromisoformat(os.getenv("FLIGHT_DEPARTURE_START", "2027-01-04"))
DEPARTURE_END = date.fromisoformat(os.getenv("FLIGHT_DEPARTURE_END", "2027-01-07"))
RETURN_START = date.fromisoformat(os.getenv("FLIGHT_RETURN_START", "2027-01-16"))
RETURN_END = date.fromisoformat(os.getenv("FLIGHT_RETURN_END", "2027-01-19"))
MAX_PRICE = float(os.getenv("FLIGHT_MAX_PRICE_BRL", "6000"))
MAX_STOPS = int(os.getenv("FLIGHT_MAX_STOPS", "2"))
SEND_SUMMARY = os.getenv("FLIGHT_SEND_SUMMARY", "false").lower() == "true"
HISTORY_FILE = Path(os.getenv("FLIGHT_HISTORY_FILE", "data/free-flight-history.json"))


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
        # Para ida e volta, o pacote entrega os segmentos concatenados. O
        # cálculo conservador abaixo evita aceitar itinerários muito longos.
        stops = get_value(flight, "stops", "stops_count", default=max(0, len(segments) - 2))
        try:
            stops = int(stops)
        except (TypeError, ValueError):
            stops = 99
        if stops <= MAX_STOPS:
            candidates.append({
                # A moeda é solicitada explicitamente como BRL na query.
                "price": price,
                "stops": stops,
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


def offer_signature(offer: dict[str, Any]) -> str:
    fields = (
        offer.get("origin"), offer.get("arrival"), offer.get("outbound"),
        offer.get("inbound"), offer.get("airline"), offer.get("price"),
        offer.get("stops"),
    )
    return "|".join(str(value) for value in fields)


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
    best = min(found, key=lambda x: x["price"])
    key = f"{best['origin']}-{best['arrival']}-{best['outbound']}-{best['inbound']}"
    previous_entry = history.get(key, {})
    previous = previous_entry.get("price")
    previous_signature = previous_entry.get("last_notified_signature")
    signature = offer_signature(best)
    history[key] = {**best, "last_notified_signature": previous_signature}
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")

    should_send = (
        signature != previous_signature
        and (SEND_SUMMARY or (best["price"] <= MAX_PRICE and (previous is None or best["price"] < previous)))
    )
    if should_send:
        message = (f"✈️ <b>Nova melhor opção encontrada</b>\n\n"
                   f"{best['origin']} → {best['arrival']}\n"
                   f"Ida: {best['outbound']} · Volta: {best['inbound']}\n"
                   f"Preço: <b>{format_brl(best['price'])}</b>\n"
                   f"Escalas: {best['stops']}\n"
                   f"Companhia: {escape(str(best['airline']))}\n"
                   f"<a href=\"{best['link']}\">Abrir no Google Flights</a>")
        send_telegram(message)
        history[key]["last_notified_signature"] = signature
        HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Alerta enviado ao Telegram.")
    else:
        print(f"Melhor preço: {format_brl(best['price'])}; nenhum alerta necessário.")


if __name__ == "__main__":
    main()
