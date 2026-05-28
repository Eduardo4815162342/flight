import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getFullHistory } from "../services/history";
import {
  buildDailyIntelligenceReport,
  renderDailyIntelligenceMarkdown,
} from "../services/intelligence";

dotenv.config();

async function generate(): Promise<void> {
  console.log("[intelligence] Carregando historico...");
  const history = await getFullHistory();
  const report = buildDailyIntelligenceReport(history);
  const markdown = renderDailyIntelligenceMarkdown(report);

  const outputDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, "daily-intelligence.json");
  const markdownPath = path.join(outputDir, "daily-intelligence.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown);

  console.log(`[intelligence] ${report.analyzedRoutes} rota(s) analisada(s).`);
  console.log(`[intelligence] Relatorio JSON: ${jsonPath}`);
  console.log(`[intelligence] Relatorio Markdown: ${markdownPath}`);
}

generate().catch((err) => {
  console.error("[intelligence] Erro ao gerar relatorio:", err);
  process.exit(1);
});
