import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import mongoose from "mongoose";

async function start() {
  await connectDatabase();
  const server = app.listen(env.PORT, () => {
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
