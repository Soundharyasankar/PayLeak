const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

export const paypalInvoiceCurrencies: Record<string, { name: string; fractionDigits: number }> =
  Object.fromEntries(
    Intl.supportedValuesOf("currency").sort().map((code) => {
      const fractionDigits = new Intl.NumberFormat("en", { style: "currency", currency: code })
        .resolvedOptions().maximumFractionDigits;
      if (fractionDigits === undefined) throw new Error(`Missing fraction-digit metadata for ${code}.`);
      return [code, { name: currencyNames.of(code) ?? code, fractionDigits }];
    }),
  );

export type PaypalInvoiceCurrency = string;
