export function currencyMinorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function parseMinorAmount(value: string, currency: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(
      "Enter a positive amount using digits and one decimal point.",
    );
  }
  const digits = currencyMinorDigits(currency);
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > digits) {
    throw new Error(
      `${currency.toUpperCase()} supports ${digits} decimal place${digits === 1 ? "" : "s"}.`,
    );
  }
  const scale = 10n ** BigInt(digits);
  const minor =
    BigInt(whole) * scale + BigInt(fraction.padEnd(digits, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("That amount is too large to store exactly.");
  }
  return Number(minor);
}

export function formatMinorAmount(
  amountMinor: number,
  currency: string,
): string {
  const digits = currencyMinorDigits(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amountMinor / 10 ** digits);
  } catch {
    return `${currency} ${(amountMinor / 10 ** digits).toFixed(digits)}`;
  }
}

export function minorAmountInput(
  amountMinor: number,
  currency: string,
): string {
  const digits = currencyMinorDigits(currency);
  if (digits === 0) return String(amountMinor);
  const scale = 10 ** digits;
  const whole = Math.floor(amountMinor / scale);
  const fraction = String(amountMinor % scale).padStart(digits, "0");
  return `${whole}.${fraction}`;
}
