import { calcCPM, classifyCPM, formatCPM, buildCPMRecommendation } from "../utils/cpm";

describe("calcCPM", () => {
  it("calcula CPM corretamente", () => {
    // R$350 / 18000 milhas = 0.01944... × 100 = 1.944 centavos/milha
    expect(calcCPM(350, 18000)).toBeCloseTo(1.944, 2);
  });

  it("retorna null quando milhas é zero", () => {
    expect(calcCPM(350, 0)).toBeNull();
  });

  it("retorna null quando cashBRL é zero ou negativo", () => {
    expect(calcCPM(0, 18000)).toBeNull();
    expect(calcCPM(-100, 18000)).toBeNull();
  });
});

describe("classifyCPM", () => {
  it("classifica como excelente quando CPM < 1.5", () => {
    expect(classifyCPM(1.2)).toBe("excelente");
  });

  it("classifica como bom quando CPM entre 1.5 e 2.5", () => {
    expect(classifyCPM(2.0)).toBe("bom");
    expect(classifyCPM(1.5)).toBe("bom");
  });

  it("classifica como regular quando CPM entre 2.5 e 3.5", () => {
    expect(classifyCPM(3.0)).toBe("regular");
    expect(classifyCPM(2.5)).toBe("regular");
  });

  it("classifica como ruim quando CPM >= 3.5", () => {
    expect(classifyCPM(4.0)).toBe("ruim");
    expect(classifyCPM(3.5)).toBe("ruim");
  });
});

describe("formatCPM", () => {
  it("formata CPM com 2 casas decimais e unidade", () => {
    expect(formatCPM(1.944)).toBe("1,94 c/milha");
    expect(formatCPM(2.5)).toBe("2,50 c/milha");
  });
});

describe("buildCPMRecommendation", () => {
  it("recomenda milhas quando CPM é excelente", () => {
    const result = buildCPMRecommendation(350, 18000, 1.94);
    expect(result).toContain("milhas");
    expect(result).toContain("excelente");
  });

  it("recomenda cash quando CPM é ruim", () => {
    const result = buildCPMRecommendation(350, 80000, 4.5);
    expect(result).toContain("cash");
    expect(result).toContain("ruim");
  });
});
