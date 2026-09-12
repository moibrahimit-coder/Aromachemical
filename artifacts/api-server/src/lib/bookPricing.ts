export type PriceTier = "offer" | "regular";

export type BookPricingSettings = {
  price: number;
  offerPrice: number;
  offerLimit: number;
  currency: string;
  stripePriceId: string | null;
  stripeOfferPriceId: string | null;
};

export type SelectedBookPrice = {
  tier: PriceTier;
  amount: number;
  currency: string;
  stripePriceId: string | null;
};

export const promotionReservationStatuses = ["pending", "paid"] as const;

export function resolveCardReconciliationStatus(args: {
  currentStatus: string;
  paymentMatches: boolean;
  checkoutStatus: string | null | undefined;
}): "pending" | "paid" | "expired" | string {
  if (args.currentStatus !== "pending") return args.currentStatus;
  if (args.paymentMatches) return "paid";
  // `open` and `complete` sessions may still lead to an asynchronous payment.
  // Only Stripe's explicit expiration is safe to release without a webhook.
  return args.checkoutStatus === "expired" ? "expired" : "pending";
}

export function isPromotionConfigured(settings: Pick<BookPricingSettings, "price" | "offerPrice" | "offerLimit">): boolean {
  return (
    Number.isFinite(settings.price) &&
    Number.isFinite(settings.offerPrice) &&
    Number.isInteger(settings.offerLimit) &&
    settings.price > settings.offerPrice &&
    settings.offerPrice > 0 &&
    settings.offerLimit > 0
  );
}

export function selectBookPrice(
  settings: BookPricingSettings,
  activeOfferReservations: number,
): SelectedBookPrice {
  const promotionAvailable =
    isPromotionConfigured(settings) && activeOfferReservations < settings.offerLimit;

  return promotionAvailable
    ? {
        tier: "offer",
        amount: settings.offerPrice,
        currency: settings.currency,
        stripePriceId: settings.stripeOfferPriceId,
      }
    : {
        tier: "regular",
        amount: settings.price,
        currency: settings.currency,
        stripePriceId: settings.stripePriceId,
      };
}

export function expectedPriceMatches(
  selected: Pick<SelectedBookPrice, "amount" | "currency">,
  expectedAmount: number,
  expectedCurrency: string,
): boolean {
  return (
    Number.isFinite(expectedAmount) &&
    expectedAmount === selected.amount &&
    expectedCurrency.toLowerCase() === selected.currency.toLowerCase()
  );
}