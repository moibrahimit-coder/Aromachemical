import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedPriceMatches,
  promotionReservationStatuses,
  resolveCardReconciliationStatus,
  selectBookPrice,
} from "./bookPricing";

const settings = {
  price: 2000,
  offerPrice: 999,
  offerLimit: 100,
  currency: "egp",
  stripePriceId: "regular_price",
  stripeOfferPriceId: "offer_price",
};

test("selects the first-edition offer until the reservation cap", () => {
  assert.equal(selectBookPrice(settings, 99).tier, "offer");
  assert.deepEqual(selectBookPrice(settings, 100), {
    tier: "regular",
    amount: 2000,
    currency: "egp",
    stripePriceId: "regular_price",
  });
});

test("only pending and paid offer orders occupy promotion slots", () => {
  assert.deepEqual(promotionReservationStatuses, ["pending", "paid"]);
});

test("rejects a stale displayed amount instead of changing the charge", () => {
  const selected = selectBookPrice(settings, 100);
  assert.equal(expectedPriceMatches(selected, 999, "egp"), false);
  assert.equal(expectedPriceMatches(selected, 2000, "EGP"), true);
});

test("lazy reconciliation only releases explicitly expired card sessions", () => {
  assert.equal(
    resolveCardReconciliationStatus({
      currentStatus: "pending",
      paymentMatches: true,
      checkoutStatus: "complete",
    }),
    "paid",
  );
  assert.equal(
    resolveCardReconciliationStatus({
      currentStatus: "pending",
      paymentMatches: false,
      checkoutStatus: "expired",
    }),
    "expired",
  );
  assert.equal(
    resolveCardReconciliationStatus({
      currentStatus: "pending",
      paymentMatches: false,
      checkoutStatus: "open",
    }),
    "pending",
  );
});