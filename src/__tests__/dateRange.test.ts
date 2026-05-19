import { generateDateRange } from "../utils/dateRange";

describe("generateDateRange", () => {
  it("gera array com uma data quando inicio === fim", () => {
    expect(generateDateRange("2026-07-20", "2026-07-20")).toEqual(["2026-07-20"]);
  });

  it("gera array ordenado de datas entre inicio e fim", () => {
    expect(generateDateRange("2026-07-20", "2026-07-22")).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
    ]);
  });

  it("respeita maxDays e trunca o range", () => {
    const result = generateDateRange("2026-07-01", "2026-08-31", 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("2026-07-01");
    expect(result[4]).toBe("2026-07-05");
  });

  it("retorna array vazio quando inicio é depois de fim", () => {
    expect(generateDateRange("2026-07-25", "2026-07-20")).toEqual([]);
  });

  it("gera exatamente 30 datas para um mês cheio (default maxDays=30)", () => {
    const result = generateDateRange("2026-07-01", "2026-08-31");
    expect(result).toHaveLength(30);
  });
});
