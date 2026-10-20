import { createApp, createBackendDependencies } from "@/app.js";
import { config } from "@/config.js";

const dependencies = await createBackendDependencies();
const app = createApp(dependencies);

app.listen(config.port, config.host, () => {
  console.log(`Mini-Juztina API disponible en http://localhost:${config.port}`);
  console.log(
    `Índice vectorial: ${dependencies.vectorStore.indexedChunkCount} chunks`,
  );
});
