export type CPMClassification = "excelente" | "bom" | "regular" | "ruim";

export function calcCPM(cashBRL: number, miles: number): number | null {
  if (cashBRL <= 0 || miles <= 0) return null;
  return (cashBRL / miles) * 100;
}

export function classifyCPM(cpm: number): CPMClassification {
  if (cpm < 1.5) return "excelente";
  if (cpm < 2.5) return "bom";
  if (cpm < 3.5) return "regular";
  return "ruim";
}

export function formatCPM(cpm: number): string {
  return `${cpm.toFixed(2).replace(".", ",")} c/milha`;
}

export function buildCPMRecommendation(
  cashBRL: number,
  miles: number,
  cpm: number
): string {
  const classification = classifyCPM(cpm);
  const formattedCPM = formatCPM(cpm);
  const formattedCash = `R$ ${cashBRL.toFixed(2).replace(".", ",")}`;
  const formattedMiles = miles.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  const lines: string[] = [
    `💳 Cash: *${formattedCash}*`,
    `🎫 Milhas: *${formattedMiles} pts*`,
    `📐 CPM: *${formattedCPM}* (${classification})`,
    "",
  ];

  if (classification === "excelente") {
    lines.push(`✅ Recomendação: *use milhas*. CPM excelente — cada milha vale muito nessa rota.`);
  } else if (classification === "bom") {
    lines.push(`✅ Recomendação: *use milhas* se não precisar do dinheiro agora. CPM bom.`);
  } else if (classification === "regular") {
    lines.push(`⚠️ Recomendação: *indiferente*. CPM regular — milhas e cash têm valor parecido.`);
  } else {
    lines.push(`❌ Recomendação: *pague em cash*. CPM ruim — suas milhas valem mais em outra rota.`);
  }

  lines.push("", `_Referência: < 1,5 excelente · 1,5–2,5 bom · 2,5–3,5 regular · > 3,5 ruim_`);
  return lines.join("\n");
}
