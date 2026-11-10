import { Decimal } from "decimal.js";
import { currencyPrecision, formatCurrencyAmount } from "../../utils/money.js";

export type VerificationStatus = "MATCH" | "MISMATCH" | "NOT_AVAILABLE" | "NOT_APPLICABLE" | "PENDING";

export interface PaypalMoneyValue {
  value?: string | null;
  currency_code?: string | null;
}

function amount(value: string | null | undefined) {
  if (value == null) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

export function isRefundOrReversal(type: string, status: string, gross: string) {
  const parsedGross = amount(gross);
  return /REFUND|REVERSAL|CHARGEBACK/i.test(type)
    || ["V", "REFUNDED", "REVERSED"].includes(status.toUpperCase())
    || Boolean(parsedGross?.isNegative());
}

export function comparePaypalMoney(
  paypal: PaypalMoneyValue | null | undefined,
  payleak: PaypalMoneyValue | null | undefined,
  applicable = true,
) {
  if (!applicable) {
    return { status: "NOT_APPLICABLE" as const, difference: null, explanation: "Calculation is not applicable to this transaction." };
  }
  if (!paypal?.value || !paypal.currency_code || !payleak?.value || !payleak.currency_code) {
    return { status: "NOT_AVAILABLE" as const, difference: null, explanation: "A PayPal-reported or independently calculated value is unavailable." };
  }
  if (paypal.currency_code.toUpperCase() !== payleak.currency_code.toUpperCase()) {
    return { status: "NOT_APPLICABLE" as const, difference: null, explanation: "The reported and calculated currencies differ; amounts were not compared." };
  }
  const reported = amount(paypal.value);
  const calculated = amount(payleak.value);
  if (!reported || !calculated) {
    return { status: "NOT_AVAILABLE" as const, difference: null, explanation: "An amount is invalid and could not be compared." };
  }
  const difference = reported.minus(calculated);
  const precision = currencyPrecision(paypal.currency_code);
  const reportedAtCurrencyPrecision = reported.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP);
  const calculatedAtCurrencyPrecision = calculated.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP);
  return {
    status: reportedAtCurrencyPrecision.equals(calculatedAtCurrencyPrecision) ? "MATCH" as const : "MISMATCH" as const,
    difference: formatCurrencyAmount(difference.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP), paypal.currency_code),
    explanation: reportedAtCurrencyPrecision.equals(calculatedAtCurrencyPrecision)
      ? "PayPal-reported and PayLeak-calculated amounts match at the currency's supported precision."
      : "PayPal-reported and PayLeak-calculated amounts differ at the currency's supported precision.",
  };
}

export function calculatePaypalTransactionValues(input: {
  gross: PaypalMoneyValue;
  fee?: PaypalMoneyValue | null;
  reportedNet?: PaypalMoneyValue | null;
  transactionType: string;
  status: string;
}) {
  const grossAmount = amount(input.gross.value);
  const feeAmount = amount(input.fee?.value);
  const isRefund = isRefundOrReversal(input.transactionType, input.status, input.gross.value ?? "");
  const sameAccountingCurrency = Boolean(
    input.gross.currency_code
    && input.fee?.currency_code
    && input.gross.currency_code.toUpperCase() === input.fee.currency_code.toUpperCase(),
  );
  const canCalculateNet = !isRefund
    && sameAccountingCurrency
    && grossAmount !== null
    && feeAmount !== null;
  let calculatedNet: PaypalMoneyValue | null = null;
  if (canCalculateNet) {
    const feeAsDeduction = feeAmount!.abs();
    const net = grossAmount!.minus(feeAsDeduction);
    const precision = currencyPrecision(input.gross.currency_code!);
    calculatedNet = {
      value: formatCurrencyAmount(net.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP), input.gross.currency_code!),
      currency_code: input.gross.currency_code,
    };
  }

  const netVerification = !input.reportedNet?.value || !input.reportedNet.currency_code
    ? comparePaypalMoney(input.reportedNet, calculatedNet)
    : isRefund || !canCalculateNet
      ? comparePaypalMoney(input.reportedNet, calculatedNet, false)
      : comparePaypalMoney(input.reportedNet, calculatedNet);

  return {
    calculatedNet,
    netVerification,
    isRefundOrReversal: isRefund,
    netCalculationApplicable: canCalculateNet,
    feeHasSameCurrency: sameAccountingCurrency,
  };
}

export function explainNetMismatch(input: {
  gross: PaypalMoneyValue;
  fee?: PaypalMoneyValue | null;
  reportedNet?: PaypalMoneyValue | null;
  calculatedNet?: PaypalMoneyValue | null;
  transactionType: string;
  status: string;
  otherFinancialFields?: string[];
}) {
  const reasons: string[] = [];
  if (!input.gross.value || !input.gross.currency_code) {
    reasons.push("PayPal did not provide a complete gross amount and currency.");
  }
  if (!input.fee?.value || !input.fee.currency_code) {
    reasons.push("PayPal did not provide a complete transaction fee and currency.");
  }
  if (input.gross.currency_code && input.fee?.currency_code
    && input.gross.currency_code.toUpperCase() !== input.fee.currency_code.toUpperCase()) {
    reasons.push("The gross amount and fee use different currencies.");
  }
  if (isRefundOrReversal(input.transactionType, input.status, input.gross.value ?? "")) {
    reasons.push("The event is a refund or reversal, so the ordinary payment formula does not apply.");
  }
  if (input.otherFinancialFields?.length) {
    reasons.push(`PayPal returned additional financial fields: ${input.otherFinancialFields.join(", ")}.`);
  }
  if (!input.reportedNet?.value || !input.reportedNet.currency_code) {
    reasons.push("PayPal did not provide a reported net amount for this transaction.");
  }
  if (input.reportedNet?.currency_code && input.calculatedNet?.currency_code
    && input.reportedNet.currency_code.toUpperCase() !== input.calculatedNet.currency_code.toUpperCase()) {
    reasons.push("PayPal's reported net currency differs from the calculated currency.");
  }
  if (input.reportedNet?.value && input.calculatedNet?.value && reasons.length === 0) {
    reasons.push("PayPal's returned transaction fields do not explain the amount difference; verify whether the values represent the same accounting stage and whether other adjustments are present.");
  }
  return reasons;
}
