import { config } from "@/config.js";
import { ingestProcessedDocuments } from "@/controllers/ingestController.js";
import { OllamaClient } from "@/controllers/ollamaClient.js";
import { VectorStore } from "@/models/vectorStore.js";

async function main(): Promise<void> {
  const ollama = new OllamaClient(
    config.ollamaBaseUrl,
    config.ollamaChatModel,
    config.ollamaEmbeddingModel,
    config.ollamaTimeoutMs,
  );
  const vectorStore = new VectorStore(config.vectorDatabasePath);
  await vectorStore.initialize();
  const count = await ingestProcessedDocuments(
    config.processedDataPath,
    ollama,
    vectorStore,
    (message) => console.log(message),
  );
  console.log(`Indexación completada: ${count} chunks persistidos en LanceDB.`);
}

main().catch((error: unknown) => {
  console.error(
    `Error al indexar los documentos: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
