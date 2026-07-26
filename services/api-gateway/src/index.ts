import { portFromEnv, startService } from "@vellar/service-kit";
import { buildServer } from "./server";

const app = buildServer();
await startService(app, { port: portFromEnv("PORT", 4000) });
