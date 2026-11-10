import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DNS_SERVERS: z.string().default("8.8.8.8,8.8.4.4"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  FRONTEND_URL: z.string().url().default(process.env.CLIENT_ORIGIN || "http://localhost:5173"),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().optional().default(""),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(""),
  PAYPAL_BASE_URL: z.string().url().default(
    process.env.PAYPAL_MODE === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com",
  ),
  PAYPAL_WEBHOOK_ID: z.string().optional().default(""),
  PAYPAL_ACCOUNT_OWNER_USER_ID: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().regex(/^[a-f\d]{24}$/i, "PAYPAL_ACCOUNT_OWNER_USER_ID must be a MongoDB user ID.").optional(),
  ),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
}).superRefine((config, context) => {
  const paypalHost = new URL(config.PAYPAL_BASE_URL).hostname;
  const expectedHost = config.PAYPAL_MODE === "sandbox" ? "api-m.sandbox.paypal.com" : "api-m.paypal.com";
  if (paypalHost !== expectedHost) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PAYPAL_BASE_URL"],
      message: `PAYPAL_BASE_URL must use ${expectedHost} for PAYPAL_MODE=${config.PAYPAL_MODE}.`,
    });
  }
  if (process.env.PAYPAL_ACCOUNT_OWNER_EMAIL && !config.PAYPAL_ACCOUNT_OWNER_USER_ID) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PAYPAL_ACCOUNT_OWNER_USER_ID"],
      message: "Email-based merchant ownership is no longer accepted; bind the designated PayLeak user by immutable MongoDB user ID.",
    });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid backend configuration: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
}

export const env = parsed.data;
