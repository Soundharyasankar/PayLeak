import { app, ensureDatabaseConnection } from "./app.js";
import { env } from "./config/env.js";
import mongoose from "mongoose";

async function start() {
  if (!env.GROQ_API_KEY) {
    throw new Error(
      "Missing GROQ_API_KEY. Set it in backend/.env for local development or the backend service environment in production.",
    );
  }
  await ensureDatabaseConnection();
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${env.PORT}`);
  });
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(() => {
      void mongoose.disconnect().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  console.error("Backend startup failed.", error instanceof Error ? error.message : "Unknown startup error.");
  process.exitCode = 1;
});
