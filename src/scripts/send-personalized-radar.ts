import dotenv from "dotenv";
import { initTables } from "../services/db";
import { runPersonalizedRadar } from "../services/personalizedRadar";

dotenv.config();

async function main(): Promise<void> {
  console.log("[personalized-radar] Inicializando banco...");
  await initTables();

  console.log("[personalized-radar] Gerando radares personalizados...");
  const result = await runPersonalizedRadar();

  console.log(
    `[personalized-radar] ${result.messagesSent} mensagem(ns) enviada(s), ` +
    `${result.itemsSent} item(ns), ${result.usersAnalyzed} usuario(s) analisado(s).`
  );
}

main().catch((err) => {
  console.error("[personalized-radar] Erro ao enviar radar:", err instanceof Error ? err.message : err);
  process.exit(1);
});
