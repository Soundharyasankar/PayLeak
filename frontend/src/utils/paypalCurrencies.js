export function paypalCurrencySymbol(currency) {
  if (!currency) return "¤";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
