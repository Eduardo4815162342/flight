import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";

// Mocking config before importing webhook service
jest.mock("../config", () => ({
  config: {
    telegram: { botToken: "test-token", chatId: "123456789" },
    search: { origin: "BSB" },
    rapidapi: { key: "test-rapidapi-key", host: "test-host" },
    apify: { tokens: ["test-apify-token"] },
  },
}));

// Mock other services exactly like webhook.test.ts
jest.mock("../services/user", () => ({
  isUserAuthorized: jest.fn(),
  saveUser: jest.fn(),
  getUserInfo: jest.fn(),
  authorizeUser: jest.fn(),
  rejectUser: jest.fn(),
  addAlert: jest.fn(),
  listUserAlerts: jest.fn(),
  removeAlert: jest.fn(),
  updateAlertPrice: jest.fn(),
}));

// Mock database and history
const mockDbExecute = jest.fn();
jest.mock("../services/db", () => ({
  getDb: jest.fn().mockReturnValue({
    execute: (...args: any[]) => mockDbExecute(...args),
    close: jest.fn(),
  }),
  initTables: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/history", () => ({
  getFullHistory: jest.fn(),
  getRoutePriceHistory: jest.fn(),
  getRouteLowestPrice: jest.fn(),
  getLatestDepartureDate: jest.fn(),
}));

import * as userService from "../services/user";
import * as historyService from "../services/history";
import {
  verifyTelegramHash,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  startWebhookServer,
} from "../services/webhook";

// Helper to generate a valid Telegram hash
function generateTelegramHash(params: Record<string, string>, botToken: string): string {
  const data = { ...params };
  delete data.hash;
  const dataCheckString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  return crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

// HTTP request helper for localhost server
function makeRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: responseBody,
          });
        });
      }
    );

    req.on("error", (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe("Dashboard Dashboard & API System", () => {
  let server: http.Server;
  let port: number;
  const botToken = "test-token";
  const axiosMock = new MockAdapter(axios);

  beforeAll((done) => {
    // Set PORT to 0 for random free port assignment
    process.env.PORT = "0";

    // Mock the telegram endpoint getMe
    axiosMock.onGet(/getMe/).reply(200, {
      ok: true,
      result: { username: "BSBPriceTrackBot" },
    });

    server = startWebhookServer();
    server.on("listening", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        port = addr.port;
      }
      done();
    });
  });

  afterAll((done) => {
    axiosMock.restore();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbExecute.mockReset();
  });

  describe("Cryptographic and Session Helpers", () => {
    it("verifyTelegramHash correctly verifies dynamic signatures", () => {
      const params = {
        id: "123456",
        first_name: "John",
        username: "john_doe",
        auth_date: "1716200000",
      };
      const hash = generateTelegramHash(params, botToken);
      const paramsWithHash = { ...params, hash };

      expect(verifyTelegramHash(paramsWithHash, botToken)).toBe(true);

      // Temper a value
      const temperedParams = { ...paramsWithHash, first_name: "Jane" };
      expect(verifyTelegramHash(temperedParams, botToken)).toBe(false);

      // Missing hash
      expect(verifyTelegramHash(params, botToken)).toBe(false);
    });

    it("creates and successfully decrypts/verifies a session token", () => {
      const session = createSessionToken("123", "John", "john_doe", botToken);
      expect(session).toBeDefined();

      const decoded = verifySessionToken(session, botToken);
      expect(decoded).toEqual({
        id: "123",
        firstName: "John",
        username: "john_doe",
      });
    });

    it("verifySessionToken returns null for bad signatures or expired sessions", () => {
      // Invalid signature
      expect(verifySessionToken("123:John:john_doe:1716200000:badsig", botToken)).toBeNull();

      // Malformed format
      expect(verifySessionToken("123:John:john_doe", botToken)).toBeNull();

      // Expired session (> 30 days)
      const oldTimestamp = (Date.now() - 31 * 24 * 60 * 60 * 1000).toString();
      const rawData = ["123", "John", "john_doe", oldTimestamp].join(":");
      const signature = crypto.createHmac("sha256", botToken).update(rawData).digest("hex");
      const expiredSession = `${rawData}:${signature}`;

      expect(verifySessionToken(expiredSession, botToken)).toBeNull();
    });

    it("parseCookies decodes headers properly", () => {
      const header = "session=xyz123; other_cookie=abc; space_cookie = value";
      const cookies = parseCookies(header);
      expect(cookies).toEqual({
        session: "xyz123",
        other_cookie: "abc",
        space_cookie: "value",
      });

      expect(parseCookies(undefined)).toEqual({});
    });
  });

  describe("API Endpoint Handlers", () => {
    describe("GET /", () => {
      it("serves the landing page (index.html)", async () => {
        const spyReadFile = jest.spyOn(fs.promises, "readFile");
        // Read actual index.html or fallback
        const res = await makeRequest(port, "GET", "/");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("<!DOCTYPE html>");
        spyReadFile.mockRestore();
      });
    });

    describe("GET /dashboard", () => {
      it("serves the dashboard page (dashboard.html)", async () => {
        const res = await makeRequest(port, "GET", "/dashboard");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("<!DOCTYPE html>");
        expect(res.body).toContain("BSB Price Track");
      });
    });

    describe("GET /api/stats", () => {
      it("aggregates and returns correct stats JSON structure", async () => {
        // Mock DB queries for count and lowest prices
        mockDbExecute.mockImplementation(async (sql) => {
          if (sql.includes("COUNT(*) as n FROM history")) {
            return { rows: [{ n: 120 }], rowsAffected: 0 };
          }
          if (sql.includes("MIN(cheapestPriceBRL)")) {
            return { rows: [{ minPrice: 299.5 }], rowsAffected: 0 };
          }
          if (sql.includes("DISTINCT")) {
            return { rows: [{ n: 5 }], rowsAffected: 0 };
          }
          if (sql.includes("users")) {
            return { rows: [{ n: 12 }], rowsAffected: 0 };
          }
          return { rows: [], rowsAffected: 0 };
        });

        const res = await makeRequest(port, "GET", "/api/stats");
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("application/json");

        const data = JSON.parse(res.body);
        expect(data.ok).toBe(true);
        expect(data.totalChecks).toBe(120);
        expect(data.lowestPrice).toBe(299.5);
        expect(data.routesCount).toBe(5);
        expect(data.activeUsersCount).toBe(12);
        expect(data.botUsername).toBe("BSBPriceTrackBot");
        expect(data.lastUpdate).toBeDefined();
      });

      it("returns 500 when database fails inside stats", async () => {
        mockDbExecute.mockRejectedValue(new Error("DB Connection Error"));
        const res = await makeRequest(port, "GET", "/api/stats");
        expect(res.statusCode).toBe(500);
        const data = JSON.parse(res.body);
        expect(data.ok).toBe(false);
      });
    });

    describe("GET /api/history", () => {
      it("returns full flight tracking history", async () => {
        const dummyHistory = [
          { origin: "BSB", destination: "GRU", departureDate: "2026-06-01", priceBRL: 350 },
          { origin: "BSB", destination: "CGH", departureDate: "2026-06-02", priceBRL: 420 },
        ];
        (historyService.getFullHistory as jest.Mock).mockResolvedValue(dummyHistory);

        const res = await makeRequest(port, "GET", "/api/history");
        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.ok).toBe(true);
        expect(data.history).toEqual(dummyHistory);
      });

      it("returns 500 when history fetching throws error", async () => {
        (historyService.getFullHistory as jest.Mock).mockRejectedValue(new Error("History fetch error"));
        const res = await makeRequest(port, "GET", "/api/history");
        expect(res.statusCode).toBe(500);
      });
    });

    describe("GET /api/auth/telegram", () => {
      it("redirects with set-cookie on valid widget signature", async () => {
        const authParams = {
          id: "987654",
          first_name: "Bruno",
          username: "brunotx",
          auth_date: Math.floor(Date.now() / 1000).toString(),
        };
        const hash = generateTelegramHash(authParams, botToken);
        const query = new URLSearchParams({ ...authParams, hash }).toString();

        const res = await makeRequest(port, "GET", `/api/auth/telegram?${query}`);

        // Redirects to dashboard
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/dashboard");

        // Sets cookie
        const setCookie = res.headers["set-cookie"];
        expect(setCookie).toBeDefined();
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        expect(cookieStr).toContain("session=");
        expect(cookieStr).toContain("HttpOnly");
        expect(cookieStr).toContain("SameSite=Lax");
      });

      it("redirects with auth_error=signature on tempered hash", async () => {
        const authParams = {
          id: "987654",
          first_name: "Bruno",
          auth_date: Math.floor(Date.now() / 1000).toString(),
        };
        const query = new URLSearchParams({ ...authParams, hash: "fakehash" }).toString();

        const res = await makeRequest(port, "GET", `/api/auth/telegram?${query}`);
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/dashboard?auth_error=signature");
      });

      it("redirects with auth_error=expired on aged authentication", async () => {
        const authParams = {
          id: "987654",
          first_name: "Bruno",
          auth_date: (Math.floor(Date.now() / 1000) - 90000).toString(), // > 24 hours ago
        };
        const hash = generateTelegramHash(authParams, botToken);
        const query = new URLSearchParams({ ...authParams, hash }).toString();

        const res = await makeRequest(port, "GET", `/api/auth/telegram?${query}`);
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/dashboard?auth_error=expired");
      });
    });

    describe("GET /api/auth/logout", () => {
      it("clears the session cookie and returns 200", async () => {
        const res = await makeRequest(port, "GET", "/api/auth/logout");
        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.ok).toBe(true);

        const setCookie = res.headers["set-cookie"];
        expect(setCookie).toBeDefined();
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        expect(cookieStr).toContain("Max-Age=0");
      });
    });

    describe("Alerts API Endpoints (/api/alerts)", () => {
      let validCookieHeader: string;
      const userId = "987654";

      beforeAll(() => {
        const sessionToken = createSessionToken(userId, "Bruno", "brunotx", botToken);
        validCookieHeader = `session=${sessionToken}`;
      });

      describe("GET /api/alerts", () => {
        it("returns 401 when session cookie is absent", async () => {
          const res = await makeRequest(port, "GET", "/api/alerts");
          expect(res.statusCode).toBe(401);
          const data = JSON.parse(res.body);
          expect(data.ok).toBe(false);
        });

        it("returns 401 when session signature is tempered", async () => {
          const res = await makeRequest(port, "GET", "/api/alerts", {
            cookie: "session=987654:Bruno:brunotx:1716200000:badhmac",
          });
          expect(res.statusCode).toBe(401);
        });

        it("returns 403 when user session is valid but user is not authorized in DB", async () => {
          (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);

          const res = await makeRequest(port, "GET", "/api/alerts", {
            cookie: validCookieHeader,
          });
          expect(res.statusCode).toBe(403);
        });

        it("returns 200 with alerts list when user is authorized", async () => {
          (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
          const mockAlerts = [
            { id: 1, origin: "BSB", destination: "GRU", departure_date: "2026-06-01", max_price_brl: 500 },
          ];
          (userService.listUserAlerts as jest.Mock).mockResolvedValue(mockAlerts);

          const res = await makeRequest(port, "GET", "/api/alerts", {
            cookie: validCookieHeader,
          });

          expect(res.statusCode).toBe(200);
          const data = JSON.parse(res.body);
          expect(data.ok).toBe(true);
          expect(data.alerts).toEqual(mockAlerts);
          expect(data.user).toEqual({ id: userId, firstName: "Bruno", username: "brunotx" });
        });
      });

      describe("POST /api/alerts", () => {
        beforeEach(() => {
          (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
        });

        it("returns 401 when not authenticated", async () => {
          const res = await makeRequest(port, "POST", "/api/alerts", {}, JSON.stringify({}));
          expect(res.statusCode).toBe(401);
        });

        it("returns 400 for malformed json", async () => {
          const res = await makeRequest(port, "POST", "/api/alerts", { cookie: validCookieHeader }, "invalid_json");
          expect(res.statusCode).toBe(400);
        });

        it("returns 400 when missing required fields", async () => {
          const payload = { origin: "BSB", destination: "GRU" };
          const res = await makeRequest(port, "POST", "/api/alerts", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(400);
        });

        it("returns 400 when airport codes are invalid", async () => {
          const payload = {
            origin: "BRASILIA",
            destination: "GRU",
            departureDate: "2026-06-01",
            tripType: "one-way",
            maxPriceBRL: 400,
          };
          const res = await makeRequest(port, "POST", "/api/alerts", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(400);
          expect(JSON.parse(res.body).message).toContain("código");
        });

        it("returns 400 when origin equals destination", async () => {
          const payload = {
            origin: "BSB",
            destination: "BSB",
            departureDate: "2026-06-01",
            tripType: "one-way",
            maxPriceBRL: 400,
          };
          const res = await makeRequest(port, "POST", "/api/alerts", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(400);
          expect(JSON.parse(res.body).message).toContain("diferentes");
        });

        it("returns 400 when price is zero or negative", async () => {
          const payload = {
            origin: "BSB",
            destination: "GRU",
            departureDate: "2026-06-01",
            tripType: "one-way",
            maxPriceBRL: -50,
          };
          const res = await makeRequest(port, "POST", "/api/alerts", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(400);
        });

        it("successfully adds an alert on valid inputs", async () => {
          (userService.addAlert as jest.Mock).mockResolvedValue(42);
          const payload = {
            origin: "BSB",
            destination: "GRU",
            departureDate: "2026-06-01",
            returnDate: "2026-06-10",
            tripType: "round-trip",
            maxPriceBRL: 850,
          };

          const res = await makeRequest(port, "POST", "/api/alerts", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(200);
          const data = JSON.parse(res.body);
          expect(data.ok).toBe(true);
          expect(data.alertId).toBe(42);
          expect(userService.addAlert).toHaveBeenCalledWith({
            chat_id: userId,
            origin: "BSB",
            destination: "GRU",
            departure_date: "2026-06-01",
            return_date: "2026-06-10",
            trip_type: "round-trip",
            max_price_brl: 850,
            is_active: true,
          });
        });
      });

      describe("POST /api/alerts/update", () => {
        beforeEach(() => {
          (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
        });

        it("returns 401 when not authenticated", async () => {
          const res = await makeRequest(port, "POST", "/api/alerts/update", {}, JSON.stringify({}));
          expect(res.statusCode).toBe(401);
        });

        it("returns 400 for bad parameters", async () => {
          const payload = { id: "not_a_number", maxPriceBRL: -20 };
          const res = await makeRequest(port, "POST", "/api/alerts/update", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(400);
        });

        it("returns 200 when update is successful", async () => {
          (userService.updateAlertPrice as jest.Mock).mockResolvedValue(true);
          const payload = { id: 10, maxPriceBRL: 450 };

          const res = await makeRequest(port, "POST", "/api/alerts/update", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(200);
          expect(JSON.parse(res.body).ok).toBe(true);
          expect(userService.updateAlertPrice).toHaveBeenCalledWith(userId, 10, 450);
        });

        it("returns 404 when alert does not exist or user is not the owner", async () => {
          (userService.updateAlertPrice as jest.Mock).mockResolvedValue(false);
          const payload = { id: 10, maxPriceBRL: 450 };

          const res = await makeRequest(port, "POST", "/api/alerts/update", { cookie: validCookieHeader }, JSON.stringify(payload));
          expect(res.statusCode).toBe(404);
        });
      });

      describe("DELETE /api/alerts", () => {
        beforeEach(() => {
          (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
        });

        it("returns 401 when not authenticated", async () => {
          const res = await makeRequest(port, "DELETE", "/api/alerts?id=5");
          expect(res.statusCode).toBe(401);
        });

        it("returns 400 for bad alert id in query params", async () => {
          const res = await makeRequest(port, "DELETE", "/api/alerts?id=invalid", { cookie: validCookieHeader });
          expect(res.statusCode).toBe(400);
        });

        it("returns 200 when removal is successful", async () => {
          (userService.removeAlert as jest.Mock).mockResolvedValue(true);
          const res = await makeRequest(port, "DELETE", "/api/alerts?id=5", { cookie: validCookieHeader });

          expect(res.statusCode).toBe(200);
          expect(JSON.parse(res.body).ok).toBe(true);
          expect(userService.removeAlert).toHaveBeenCalledWith(userId, 5);
        });

        it("returns 404 when alert is not found or not owned by user", async () => {
          (userService.removeAlert as jest.Mock).mockResolvedValue(false);
          const res = await makeRequest(port, "DELETE", "/api/alerts?id=5", { cookie: validCookieHeader });
          expect(res.statusCode).toBe(404);
        });
      });
    });

    describe("Fallback 404 handling", () => {
      it("returns 404 for unknown endpoints", async () => {
        const res = await makeRequest(port, "GET", "/api/nonexistent");
        expect(res.statusCode).toBe(404);
        expect(res.body).toBe("Not Found");
      });
    });
  });
});
