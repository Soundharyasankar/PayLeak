import cors from "cors";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { connectDatabase } from "./config/database.ts";
import { env } from "./config/env.js";
import { errorMiddleware } from "./middleware/errorMiddleware.ts";
import { aiRoutes } from "./routes/aiRoutes.ts";
import { analyticsRoutes } from "./routes/analyticsRoutes.ts";
import { authRoutes } from "./routes/authRoutes.ts";
import { clientRoutes } from "./routes/clientRoutes.js";
import { currencyRoutes } from "./routes/currencyRoutes.js";
import { invoiceRoutes } from "./routes/invoiceRoutes.ts";
import { notificationRoutes } from "./routes/notificationRoutes.js";
import { paypalRoutes, paypalWebhookRoutes } from "./routes/paypalRoutes.js";
import { transactionRoutes } from "./routes/transactionRoutes.js";
import { rateLimitExceeded } from "./utils/response.ts";

export const app = express();
const apiLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, handler: rateLimitExceeded });
let databaseConnection: Promise<void> | null = null;

export async function ensureDatabaseConnection() {
  if (mongoose.connection.readyState === 1) return;
  if (!databaseConnection) {
    databaseConnection = connectDatabase().catch((error: unknown) => {
      databaseConnection = null;
      throw error;
    });
  }
  await databaseConnection;
}

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Accept", "Authorization", "Content-Type", "Idempotency-Key"],
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: "1mb" }));
app.use((_req, _res, next) => {
  if (env.NODE_ENV === "test") {
    next();
    return;
  }
  void ensureDatabaseConnection().then(() => next(), next);
});
app.use("/api", apiLimit);

app.get(["/health", "/api/health"], (_req, res) => res.json({
  success: true,
  data: {
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    databaseName: mongoose.connection.readyState === 1 ? mongoose.connection.db?.databaseName ?? null : null,
  },
}));

app.use("/api/auth", authRoutes);
app.use("/api/paypal", paypalWebhookRoutes);
app.use("/api/paypal", paypalRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/currency", currencyRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ai", aiRoutes);

app.use((_req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "API endpoint not found." } }));
app.use(errorMiddleware);

export default app;
