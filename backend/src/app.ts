import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { config } from "@/config.js";
import {
  LegalChatService,
  UnverifiableAnswerError,
} from "@/controllers/chatController.js";
import { OllamaError, OllamaClient } from "@/controllers/ollamaClient.js";
import { createApiRouter } from "@/views/apiRoutes.js";
import { VectorStore } from "@/models/vectorStore.js";

export interface BackendDependencies {
  ollama: OllamaClient;
  vectorStore: VectorStore;
}

export function createApp(
  dependencies: BackendDependencies,
  corsOrigin = config.corsOrigin,
): express.Express {
  const app = express();
  const chatService = new LegalChatService(
    dependencies.ollama,
    dependencies.vectorStore,
    config,
  );

  app.disable("x-powered-by");
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createApiRouter(chatService, dependencies.ollama, dependencies.vectorStore));
  app.use((_request, response) => {
    response.status(404).json({ error: "Ruta no encontrada" });
  });
  app.use(((error, _request, response, _next) => {
    if (error instanceof OllamaError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof UnverifiableAnswerError) {
      response.status(error.statusCode).json({
        error: error.message,
        sources: error.sources,
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "El cuerpo JSON de la solicitud es inválido." });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      response.status(413).json({ error: "El cuerpo de la solicitud excede 16 KB." });
      return;
    }

    console.error("Error no controlado en la API:", error);
    response.status(500).json({ error: "Error interno del servidor." });
  }) satisfies ErrorRequestHandler);

  return app;
}

export async function createBackendDependencies(): Promise<BackendDependencies> {
  const vectorStore = new VectorStore(config.vectorDatabasePath);
  await vectorStore.initialize();
  const ollama = new OllamaClient(
    config.ollamaBaseUrl,
    config.ollamaChatModel,
    config.ollamaEmbeddingModel,
    config.ollamaTimeoutMs,
  );
  return { ollama, vectorStore };
}
