import { env } from "../config/env.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { AppError } from "../utils/errors.js";
import { paypalRequest } from "./paypalClient.js";

interface PaypalWebhookEvent {
  id?: string;
  event_type?: string;
  resource?: { id?: string };
  [key: string]: unknown;
}

export async function verifyAndStoreWebhook(headers: Record<string, string | undefined>, event: PaypalWebhookEvent) {
  if (!env.PAYPAL_WEBHOOK_ID) {
    throw new AppError(503, "PayPal webhook verification is not configured.", "PAYPAL_WEBHOOK_UNAVAILABLE");
  }
  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const transmissionSignature = headers["paypal-transmission-sig"];
  const certificateUrl = headers["paypal-cert-url"];
  const authAlgorithm = headers["paypal-auth-algo"];
  if (!transmissionId || !transmissionTime || !transmissionSignature || !certificateUrl || !authAlgorithm || !event.id || !event.event_type) {
    throw new AppError(400, "Required PayPal webhook headers or event fields are missing.", "INVALID_WEBHOOK");
  }
  const verification = await paypalRequest<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: authAlgorithm,
      cert_url: certificateUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSignature,
      transmission_time: transmissionTime,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  });
  if (verification.verification_status !== "SUCCESS") {
    throw new AppError(401, "PayPal webhook signature verification failed.", "INVALID_WEBHOOK_SIGNATURE");
  }
  const existing = await WebhookEvent.exists({ eventId: event.id });
  if (existing) return { accepted: true, duplicate: true, processed: false };
  try {
    await WebhookEvent.create({
      eventId: event.id,
      eventType: event.event_type,
      resourceId: event.resource?.id ?? null,
      verified: true,
      processingStatus: "unmatched",
      receivedAt: new Date(),
      payload: event,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) return { accepted: true, duplicate: true, processed: false };
    throw error;
  }
  return { accepted: true, duplicate: false, processed: false, reason: "No merchant-owner mapping was available for event processing." };
}
