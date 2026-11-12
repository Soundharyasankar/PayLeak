const confirmedPaymentPairs = [
  { transactionType: "T0006", status: "S" },
  { transactionType: "PAYMENT_CAPTURE", status: "COMPLETED" },
] as const;

export const confirmedPaymentFilter = {
  $or: confirmedPaymentPairs.map(({ transactionType, status }) => ({ transactionType, status })),
};

export function isConfirmedPaymentTransaction(transaction: {
  transactionType: string;
  status: string;
}) {
  return confirmedPaymentPairs.some((pair) =>
    transaction.transactionType.toUpperCase() === pair.transactionType
    && transaction.status.toUpperCase() === pair.status,
  );
}
