import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { PayPalOrder } from "../models/PayPalOrder.js";
import { Transaction } from "../models/Transaction.js";
import { AppError } from "../utils/errors.js";
import { paypalRequest } from "./paypalClient.js";

interface PaypalOrderResponse {
  id: string;
  status: string;
  links?: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{
    amount?: { currency_code?: string; value?: string };
    payments?: { captures?: PaypalCapture[] };
  }>;
}

interface PaypalCapture {
  id: string;
  status: string;
  amount?: { currency_code?: string; value?: string };
  create_time?: string;
  seller_receivable_breakdown?: {
    gross_amount?: { currency_code?: string; value?: string };
    paypal_fee?: { currency_code?: string; value?: string };
    net_amount?: { currency_code?: string; value?: string };
  };
}

function assertSandbox() {
  if (env.PAYPAL_MODE !== "sandbox" || !env.PAYPAL_BASE_URL.includes("sandbox")) {
    throw new AppError(503, "PayPal Checkout is restricted to the configured Sandbox environment.", "PAYPAL_SANDBOX_ONLY");
  }
}

function normalizedAmount(value: string) {
  try {
    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2) throw new Error("invalid");
    return amount.toFixed(2);
  } catch {
    throw new AppError(400, "Amount must be greater than zero and have no more than two decimal places.", "INVALID_PAYMENT_AMOUNT");
  }
}

export async function createSandboxOrder(userId: string, input: {
  idempotencyKey: string; amount: string; currency: string; description: string;
}) {
  assertSandbox();
  const amount = normalizedAmount(input.amount);
  const currency = input.currency.toUpperCase();
  let order = await PayPalOrder.findOne({ userId, idempotencyKey: input.idempotencyKey });
  if (order) {
    if (order.amount !== amount || order.currency !== currency || order.description !== input.description) {
      throw new AppError(409, "This idempotency key was already used for a different payment.", "IDEMPOTENCY_CONFLICT");
    }
    if (order.approvalUrl && order.paypalOrderId) {
      if (order.status !== "CREATED") {
        throw new AppError(409, "This PayPal order is no longer available for approval.", "PAYPAL_ORDER_NOT_CREATABLE");
      }
      return { id: order.paypalOrderId, status: order.status, approvalUrl: order.approvalUrl };
    }
    if (order.status !== "FAILED") {
      throw new AppError(409, "This payment request is already being processed.", "PAYPAL_ORDER_PENDING");
    }
    order.status = "CREATING";
    await order.save();
  } else {
    try {
      order = await PayPalOrder.create({
        userId,
        idempotencyKey: input.idempotencyKey,
        captureRequestId: randomUUID(),
        amount,
        currency,
        description: input.description,
        status: "CREATING",
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new AppError(409, "This payment request is already being processed.", "PAYPAL_ORDER_PENDING");
      }
      throw error;
    }
  }

  let created: PaypalOrderResponse;
  try {
    created = await paypalRequest<PaypalOrderResponse>("/v2/checkout/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "PayPal-Request-Id": order.idempotencyKey },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: String(order._id),
          description: input.description,
          amount: { currency_code: currency, value: amount },
        }],
        application_context: {
          brand_name: "PayLeak",
          user_action: "PAY_NOW",
          return_url: `${env.FRONTEND_URL}/paypal/return`,
          cancel_url: `${env.FRONTEND_URL}/paypal/cancel`,
        },
      }),
    });
  } catch (error) {
    order.status = "FAILED";
    await order.save();
    throw error;
  }
  const approvalUrl = created.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
  if (!created.id || !approvalUrl || !approvalUrl.startsWith("https://www.sandbox.paypal.com/")) {
    order.status = "FAILED";
    await order.save();
    throw new AppError(502, "PayPal did not return a valid Sandbox approval URL.", "PAYPAL_INVALID_RESPONSE");
  }
  order.paypalOrderId = created.id;
  order.status = "CREATED";
  order.approvalUrl = approvalUrl;
  await order.save();
  return { id: created.id, status: order.status, approvalUrl };
}

function findCompletedCapture(paypalOrder: PaypalOrderResponse) {
  return paypalOrder.purchase_units?.flatMap((unit) => unit.payments?.captures ?? [])
    .find((capture) => capture.status === "COMPLETED");
}

function ensureExpectedAmount(capture: PaypalCapture, expected: { amount: string; currency: string }) {
  const value = capture.amount?.value;
  const currency = capture.amount?.currency_code;
  if (!value || !currency || currency !== expected.currency || new Decimal(value).comparedTo(expected.amount) !== 0) {
    throw new AppError(502, "The completed PayPal capture does not match the stored payment amount.", "PAYPAL_CAPTURE_MISMATCH");
  }
}

export async function captureSandboxOrder(userId: string, paypalOrderId: string) {
  assertSandbox();
  const localOrder = await PayPalOrder.findOne({ userId, paypalOrderId });
  if (!localOrder) throw new AppError(404, "PayPal order not found for this account.", "PAYPAL_ORDER_NOT_FOUND");
  if (localOrder.status === "CANCELLED" || localOrder.status === "FAILED") {
    throw new AppError(409, "This PayPal order cannot be captured.", "PAYPAL_ORDER_NOT_CAPTUREABLE");
  }
  if (localOrder.status === "COMPLETED" && localOrder.captureId) {
    const stored = await Transaction.findOne({ userId, paypalTransactionId: localOrder.captureId }).lean();
    if (stored) return { orderId: paypalOrderId, captureId: localOrder.captureId, status: "COMPLETED", transactionStored: true };
  }

  let verifiedOrder = await paypalRequest<PaypalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  if (verifiedOrder.status !== "COMPLETED") {
    if (verifiedOrder.status !== "APPROVED") {
      throw new AppError(409, "The PayPal buyer approval has not completed; no payment was captured.", "PAYPAL_APPROVAL_REQUIRED");
    }
    try {
      verifiedOrder = await paypalRequest<PaypalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "PayPal-Request-Id": localOrder.captureRequestId },
        body: "{}",
      });
    } catch (captureError) {
      const currentOrder = await paypalRequest<PaypalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
      if (currentOrder.status !== "COMPLETED") throw captureError;
      verifiedOrder = currentOrder;
    }
  }

  if (verifiedOrder.status !== "COMPLETED") {
    throw new AppError(502, "PayPal did not confirm a completed capture.", "PAYPAL_CAPTURE_UNCONFIRMED");
  }
  const capture = findCompletedCapture(verifiedOrder);
  if (!capture?.id) throw new AppError(502, "PayPal completed the order without returning a capture record.", "PAYPAL_INVALID_RESPONSE");
  ensureExpectedAmount(capture, localOrder);
  const gross = capture.seller_receivable_breakdown?.gross_amount ?? capture.amount;
  if (!gross?.value || !gross.currency_code) {
    throw new AppError(502, "PayPal did not return the captured amount and currency.", "PAYPAL_INVALID_RESPONSE");
  }
  const fee = capture.seller_receivable_breakdown?.paypal_fee;
  const net = capture.seller_receivable_breakdown?.net_amount;
  const retrievedAt = new Date();
  const transactionDate = capture.create_time && Number.isFinite(Date.parse(capture.create_time))
    ? new Date(capture.create_time)
    : retrievedAt;

  await Transaction.updateOne(
    { userId: new Types.ObjectId(userId), paypalTransactionId: capture.id },
    {
      $setOnInsert: {
        userId: new Types.ObjectId(userId),
        paypalTransactionId: capture.id,
        transactionType: "PAYMENT_CAPTURE",
        status: capture.status,
        grossAmount: gross.value,
        grossCurrency: gross.currency_code,
        feeAmount: fee?.value ?? null,
        feeCurrency: fee?.currency_code ?? null,
        feeSource: fee?.value && fee.currency_code ? "actual_paypal" : "unavailable",
        finalAmount: net?.value ?? null,
        finalCurrency: net?.currency_code ?? null,
        transactionDate,
        financialDataStatus: fee?.value && fee.currency_code && net?.value && net.currency_code ? "complete" : "incomplete",
        rawPaypal: capture,
        retrievedAt,
      },
    },
    { upsert: true, runValidators: true },
  );
  localOrder.captureId = capture.id;
  localOrder.status = "COMPLETED";
  await localOrder.save();
  return { orderId: paypalOrderId, captureId: capture.id, status: capture.status, transactionStored: true };
}

export async function cancelSandboxOrder(userId: string, paypalOrderId: string) {
  assertSandbox();
  const order = await PayPalOrder.findOne({ userId, paypalOrderId });
  if (!order) throw new AppError(404, "PayPal order not found for this account.", "PAYPAL_ORDER_NOT_FOUND");
  const remoteOrder = await paypalRequest<PaypalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  if (remoteOrder.status === "COMPLETED" || order.status === "COMPLETED") {
    await captureSandboxOrder(userId, paypalOrderId);
    throw new AppError(409, "PayPal already confirmed this payment; it cannot be marked cancelled.", "PAYPAL_ORDER_COMPLETED");
  }
  if (remoteOrder.status === "VOIDED") {
    order.status = "CANCELLED";
    await order.save();
    return { orderId: paypalOrderId, status: "CANCELLED", captured: false };
  }
  return { orderId: paypalOrderId, status: remoteOrder.status, captured: false, cancellationConfirmed: false };
}
