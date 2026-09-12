import { ReplitConnectors } from "@replit/connectors-sdk";

const stripeConnectors = new ReplitConnectors();

export class StripeProviderError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Stripe provider request failed");
    this.name = "StripeProviderError";
    this.status = status;
  }
}

export type StripePrice = {
  id: string;
  active?: boolean;
  currency?: string;
  unit_amount?: number | null;
  product?: string | { id: string };
};

export type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  status?: string | null;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  line_items?: {
    data?: Array<{ quantity?: number | null; price?: { id?: string | null } | null }>;
  };
};

async function stripeRequest<T>(
  path: string,
  method: "GET" | "POST",
  params?: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (params) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await stripeConnectors.proxy("stripe", path, {
    method,
    headers,
    body: params,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new StripeProviderError(response.status);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new StripeProviderError(502);
  }
}

export function amountInMinorUnits(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid monetary amount");
  }
  return Math.round(amount * 100);
}

export async function getStripePrice(priceId: string): Promise<StripePrice> {
  return stripeRequest<StripePrice>(
    `/v1/prices/${encodeURIComponent(priceId)}`,
    "GET",
  );
}

export async function createStripeCatalogPrice(args: {
  currentProductId: string | null;
  currentPriceId: string | null;
  price: number;
  currency: "egp" | "usd";
}): Promise<{ productId: string; priceId: string }> {
  const minorAmount = amountInMinorUnits(args.price);
  if (args.currentProductId && args.currentPriceId) {
    try {
      const existing = await getStripePrice(args.currentPriceId);
      if (
        existing.active !== false &&
        existing.unit_amount === minorAmount &&
        existing.currency === args.currency
      ) {
        return { productId: args.currentProductId, priceId: args.currentPriceId };
      }
    } catch (error) {
      // Only a genuinely missing price may create a replacement. Do not
      // duplicate the catalog after a transient connector failure.
      if (!(error instanceof StripeProviderError) || error.status !== 404) {
        throw error;
      }
    }
  }

  let productId = args.currentProductId;
  if (!productId) {
    const product = await stripeRequest<{ id?: string }>(
      "/v1/products",
      "POST",
      new URLSearchParams({
        name: "Aroma School eBook",
        description: "Aroma School digital book",
      }),
    );
    if (!product.id) throw new StripeProviderError(502);
    productId = product.id;
  }

  const stripePrice = await stripeRequest<{ id?: string }>(
    "/v1/prices",
    "POST",
    new URLSearchParams({
      product: productId,
      unit_amount: String(minorAmount),
      currency: args.currency,
    }),
  );
  if (!stripePrice.id) throw new StripeProviderError(502);
  return { productId, priceId: stripePrice.id };
}

export function getTrustedRuntimeOrigin(): string {
  const configured = [
    ...(process.env.REPLIT_DOMAINS?.split(",") ?? []),
    process.env.REPLIT_DEV_DOMAIN,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))[0];
  if (!configured) {
    throw new Error("A trusted runtime domain is not configured");
  }
  const candidate = configured.includes("://")
    ? new URL(configured)
    : new URL(`https://${configured}`);
  if (!["http:", "https:"].includes(candidate.protocol)) {
    throw new Error("Invalid trusted runtime domain");
  }
  return `${candidate.protocol}//${candidate.host}`;
}

export async function createStripeCheckoutSession(args: {
  orderId: string;
  priceId: string;
  amount: number;
  currency: "egp" | "usd";
  idempotencyKey: string;
}): Promise<StripeCheckoutSession> {
  const origin = getTrustedRuntimeOrigin();
  const params = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": args.priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/user-portal?order=${encodeURIComponent(args.orderId)}`,
    cancel_url: `${origin}/checkout?cancelled=1`,
    client_reference_id: args.orderId,
    "metadata[orderId]": args.orderId,
  });
  return stripeRequest<StripeCheckoutSession>(
    "/v1/checkout/sessions",
    "POST",
    params,
    args.idempotencyKey,
  );
}

export async function verifyStripeCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items.data.price`,
    "GET",
  );
}