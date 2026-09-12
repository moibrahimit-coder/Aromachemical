import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateBookOrderBody,
  CreateBookOrderResponse,
  DownloadBookParams,
  DownloadReceiptParams,
  GetBookMeResponse,
  GetBookSettingsResponse,
  ListAdminBookOrdersResponse,
  ListBookOrdersResponse,
  RequestBookUploadBody,
  RequestBookUploadResponse,
  ReviewBookOrderBody,
  ReviewBookOrderParams,
  ReviewBookOrderResponse,
  RetryBookCheckoutParams,
  RetryBookCheckoutResponse,
  SaveBookSettingsBody,
  SaveBookSettingsResponse,
  VerifyBookPaymentParams,
  VerifyBookPaymentResponse,
} from "@workspace/api-zod";
import {
  bookOrdersTable,
  bookSettingsTable,
  bookUploadsTable,
  db,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { requireAdmin, requireAuth, userIsAdmin } from "../middlewares/auth";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import {
  amountInMinorUnits,
  createStripeCatalogPrice,
  createStripeCheckoutSession,
  getStripePrice,
  StripeProviderError,
  verifyStripeCheckoutSession,
} from "../lib/stripe";
import {
  expectedPriceMatches,
  isPromotionConfigured,
  resolveCardReconciliationStatus,
  selectBookPrice,
} from "../lib/bookPricing";
import { logger } from "../lib/logger";
import { isVercelRuntime } from "../lib/runtime";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const defaultSettings = {
  id: 1,
  price: 2000,
  offerPrice: 999,
  offerLimit: 100,
  currency: "egp",
  vodafoneCash: "",
  instaPay: "",
  bookObjectPath: null,
  stripeProductId: null,
  stripePriceId: null,
  stripeOfferPriceId: null,
  salesEnabled: false,
  updatedBy: null,
} as const;

class OrderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderConflictError";
  }
}

class CardCheckoutConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardCheckoutConfigurationError";
  }
}

const promotionReconciliationLimit = 20;

async function getSettings() {
  await db
    .insert(bookSettingsTable)
    .values(defaultSettings)
    .onConflictDoNothing({ target: bookSettingsTable.id });
  const [settings] = await db
    .select()
    .from(bookSettingsTable)
    .where(eq(bookSettingsTable.id, 1));
  return settings ?? defaultSettings;
}

async function getUpload(objectPath: string) {
  const [upload] = await db
    .select()
    .from(bookUploadsTable)
    .where(eq(bookUploadsTable.objectPath, objectPath));
  return upload;
}

async function hasValidBook(settings: Awaited<ReturnType<typeof getSettings>>) {
  if (!settings.bookObjectPath) return false;
  const upload = await getUpload(settings.bookObjectPath);
  if (!upload || upload.purpose !== "book" || upload.contentType !== "application/pdf") {
    return false;
  }
  try {
    await objectStorage.validateUploadedObject(upload.objectPath, {
      size: upload.size,
      contentType: "application/pdf",
    });
    return true;
  } catch {
    return false;
  }
}

async function countActiveOfferReservations() {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookOrdersTable)
    .where(
      and(
        eq(bookOrdersTable.priceTier, "offer"),
        sql`${bookOrdersTable.status} IN ('pending', 'paid')`,
      ),
    );
  return result?.count ?? 0;
}

async function toPublicSettings() {
  const settings = await getSettings();
  const bookReady = await hasValidBook(settings);
  await reconcilePendingPromotionCardOrders();
  const activeOfferReservations = await countActiveOfferReservations();
  const selectedPrice = selectBookPrice(settings, activeOfferReservations);
  const offerAvailable =
    isPromotionConfigured(settings) && selectedPrice.tier === "offer";
  const cardReady = Boolean(selectedPrice.stripePriceId);
  const paymentMethodReady =
    settings.vodafoneCash.trim().length > 0 ||
    settings.instaPay.trim().length > 0 ||
    cardReady;
  return GetBookSettingsResponse.parse({
    price: settings.price,
    offerPrice: settings.offerPrice,
    offerLimit: settings.offerLimit,
    offerAvailable,
    currency: settings.currency,
    vodafoneCash: settings.vodafoneCash,
    instaPay: settings.instaPay,
    bookReady,
    cardReady,
    salesEnabled:
      settings.salesEnabled &&
      settings.price > 0 &&
      bookReady &&
      paymentMethodReady,
  });
}

function orderResponse(order: typeof bookOrdersTable.$inferSelect) {
  return {
    id: order.id,
    name: order.name,
    email: order.email,
    method: order.method,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    priceTier: order.priceTier,
    createdAt: order.createdAt.toISOString(),
    hasReceipt: Boolean(order.receiptObjectPath),
    checkoutUrl: order.checkoutUrl,
    reviewNote: order.reviewNote,
  };
}

async function sendPrivateObject(
  req: Request,
  res: Response,
  filePath: string,
  filename: string,
): Promise<void> {
  const response = await objectStorage.downloadObject(
    await objectStorage.getObjectEntityFile(filePath),
  );
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  if (!response.body) {
    res.end();
    return;
  }
  const nodeStream = (await import("node:stream")).Readable.fromWeb(
    response.body as ReadableStream<Uint8Array>,
  );
  nodeStream.on("error", (error) => req.log.error({ err: error }, "Private object stream failed"));
  nodeStream.pipe(res);
}

async function sendAuthorizedPrivateDownload(
  req: Request,
  res: Response,
  filePath: string,
  filename: string,
): Promise<void> {
  if (isVercelRuntime()) {
    // The signed URL is sent only in this redirect after the caller passed all
    // route-specific authorization and file-validation checks. Do not log it.
    const downloadURL = await objectStorage.getVercelPrivateDownloadURL(
      filePath,
      filename,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(302, downloadURL);
    return;
  }
  // Preserve the existing Replit sidecar-backed stream.
  await sendPrivateObject(req, res, filePath, filename);
}

async function verifyCardPayment(
  order: typeof bookOrdersTable.$inferSelect,
): Promise<boolean> {
  if (order.method !== "card" || !order.stripeCheckoutSessionId || !order.stripePriceId) {
    return order.method !== "card";
  }
  const session = await verifyStripeCheckoutSession(order.stripeCheckoutSessionId);
  const lineItem = session.line_items?.data?.[0];
  const paymentMatches =
    session.payment_status === "paid" &&
    session.status === "complete" &&
    session.amount_total === amountInMinorUnits(order.amount) &&
    session.currency === order.currency &&
    session.client_reference_id === order.id &&
    session.metadata?.orderId === order.id &&
    lineItem?.quantity === 1 &&
    lineItem.price?.id === order.stripePriceId;
  const nextStatus = resolveCardReconciliationStatus({
    currentStatus: order.status,
    paymentMatches,
    checkoutStatus: session.status,
  });
  if (nextStatus !== order.status) {
    await db
      .update(bookOrdersTable)
      .set({
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(bookOrdersTable.id, order.id), eq(bookOrdersTable.status, "pending")));
  }
  return paymentMatches;
}

async function reconcilePendingPromotionCardOrders(): Promise<void> {
  const pendingOrders = await db
    .select()
    .from(bookOrdersTable)
    .where(
      and(
        eq(bookOrdersTable.method, "card"),
        eq(bookOrdersTable.priceTier, "offer"),
        eq(bookOrdersTable.status, "pending"),
        isNotNull(bookOrdersTable.stripeCheckoutSessionId),
      ),
    )
    .limit(promotionReconciliationLimit);
  const results = await Promise.allSettled(pendingOrders.map(verifyCardPayment));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    logger.warn(
      { failed, checked: pendingOrders.length },
      "Some pending promotional Stripe sessions could not be reconciled",
    );
  }
}

function isDefinitivePreSessionFailure(
  error: unknown,
  order: typeof bookOrdersTable.$inferSelect,
): boolean {
  return (
    !order.stripeCheckoutSessionId &&
    (error instanceof CardCheckoutConfigurationError ||
      (error instanceof StripeProviderError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429))
  );
}

async function markDefinitivelyFailedCheckout(
  error: unknown,
  order: typeof bookOrdersTable.$inferSelect,
): Promise<void> {
  if (!isDefinitivePreSessionFailure(error, order)) return;
  await db
    .update(bookOrdersTable)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(bookOrdersTable.id, order.id),
        eq(bookOrdersTable.status, "pending"),
        isNull(bookOrdersTable.stripeCheckoutSessionId),
      ),
    );
}

async function createOrResumeCardCheckout(
  order: typeof bookOrdersTable.$inferSelect,
): Promise<typeof bookOrdersTable.$inferSelect> {
  if (order.checkoutUrl) return order;
  if (!order.stripePriceId) {
    throw new CardCheckoutConfigurationError("Card checkout is not configured for this order");
  }
  if (order.stripeCheckoutSessionId) {
    throw new Error("A checkout session exists but cannot be resumed from this order");
  }
  const providerPrice = await getStripePrice(order.stripePriceId!);
  if (
    providerPrice.active === false ||
    providerPrice.unit_amount !== amountInMinorUnits(order.amount) ||
    providerPrice.currency !== order.currency
  ) {
    throw new CardCheckoutConfigurationError(
      "Configured Stripe price does not match the server snapshot",
    );
  }
  const session = await createStripeCheckoutSession({
    orderId: order.id,
    priceId: order.stripePriceId!,
    amount: order.amount,
    currency: order.currency as "egp" | "usd",
    idempotencyKey: `book-order-${order.id}`,
  });
  if (!session.url) {
    // A response without a URL can still represent an accepted provider
    // request, so keep this order pending rather than releasing its slot.
    throw new Error("Stripe returned no checkout URL");
  }
  const [updated] = await db
    .update(bookOrdersTable)
    .set({
      stripeCheckoutSessionId: session.id,
      checkoutUrl: session.url,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bookOrdersTable.id, order.id),
        eq(bookOrdersTable.status, "pending"),
        isNull(bookOrdersTable.stripeCheckoutSessionId),
      ),
    )
    .returning();
  return updated ?? order;
}

router.get("/book/settings", async (_req, res): Promise<void> => {
  res.json(await toPublicSettings());
});

router.get("/book/me", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  let isAdmin = false;
  if (userId) {
    try {
      isAdmin = await userIsAdmin(userId);
    } catch (error) {
      req.log.error({ err: error }, "Unable to resolve Clerk admin metadata");
    }
  }
  res.json(GetBookMeResponse.parse({ signedIn: Boolean(userId), isAdmin }));
});

router.post("/book/uploads", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestBookUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload metadata" });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;
  const { size, contentType, purpose, name } = parsed.data;
  if (purpose === "receipt" && size > 5 * 1024 * 1024) {
    res.status(400).json({ error: "Receipt files must be 5 MB or smaller" });
    return;
  }
  if (purpose === "book") {
    if (contentType !== "application/pdf") {
      res.status(400).json({ error: "Book uploads must be PDF files" });
      return;
    }
    try {
      if (!(await userIsAdmin(userId))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } catch (error) {
      req.log.error({ err: error }, "Unable to resolve Clerk admin metadata");
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  try {
    const { uploadURL, objectPath } =
      await objectStorage.createObjectEntityUploadDestination();
    if (!objectPath.startsWith("/objects/")) {
      throw new Error("Object storage returned an invalid object path");
    }
    const [upload] = await db
      .insert(bookUploadsTable)
      .values({
        objectPath,
        ownerId: userId,
        purpose,
        name,
        size,
        contentType,
      })
      .returning();
    if (!upload) throw new Error("Unable to persist upload metadata");
    res.json(RequestBookUploadResponse.parse({ uploadURL, objectPath }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create private upload destination");
    res.status(500).json({ error: "Unable to create upload destination" });
  }
});

router.get("/book/orders", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const orders = await db
    .select()
    .from(bookOrdersTable)
    .where(eq(bookOrdersTable.clerkUserId, userId))
    .orderBy(desc(bookOrdersTable.createdAt));
  res.json(ListBookOrdersResponse.parse(orders.map(orderResponse)));
});

router.post("/book/orders", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateBookOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order input" });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;
  const settings = await getSettings();
  const bookReady = await hasValidBook(settings);
  const paymentMethodReady =
    settings.vodafoneCash.trim().length > 0 || settings.instaPay.trim().length > 0;
  if (
    !settings.salesEnabled ||
    settings.price <= 0 ||
    !bookReady ||
    (parsed.data.method !== "card" && !paymentMethodReady)
  ) {
    res.status(409).json({ error: "Sales are not currently available" });
    return;
  }
  if (
    (parsed.data.method === "vodafone" && settings.vodafoneCash.trim().length === 0) ||
    (parsed.data.method === "instapay" && settings.instaPay.trim().length === 0)
  ) {
    res.status(409).json({ error: "Selected payment method is not configured" });
    return;
  }
  const receiptPath = parsed.data.receiptObjectPath;
  if (parsed.data.method === "card" && receiptPath) {
    res.status(400).json({ error: "Card orders cannot include a manual receipt" });
    return;
  }

  let receiptUpload: Awaited<ReturnType<typeof getUpload>> | undefined;
  if (parsed.data.method !== "card") {
    if (!receiptPath) {
      res.status(400).json({ error: "A receipt is required for manual payment" });
      return;
    }
    receiptUpload = await getUpload(receiptPath);
    if (
      !receiptUpload ||
      receiptUpload.ownerId !== userId ||
      receiptUpload.purpose !== "receipt" ||
      receiptUpload.usedAt ||
      !["image/jpeg", "image/png", "application/pdf"].includes(receiptUpload.contentType)
    ) {
      res.status(400).json({ error: "Receipt upload is invalid or already used" });
      return;
    }
    try {
      await objectStorage.validateUploadedObject(receiptPath, {
        size: receiptUpload.size,
        contentType: receiptUpload.contentType as "image/jpeg" | "image/png" | "application/pdf",
      });
    } catch {
      res.status(400).json({ error: "Receipt upload is incomplete or invalid" });
      return;
    }
  }

  const rawIdempotencyKey = req.header("Idempotency-Key");
  const idempotencyKey =
    rawIdempotencyKey?.trim().length
      ? rawIdempotencyKey.trim().slice(0, 255)
      : undefined;
  let order: typeof bookOrdersTable.$inferSelect | undefined;
  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(bookOrdersTable)
      .where(
        and(
          eq(bookOrdersTable.clerkUserId, userId),
          eq(bookOrdersTable.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      if (
        existing.method !== "card" ||
        existing.status !== "pending" ||
        existing.checkoutUrl
      ) {
        res.status(201).json(CreateBookOrderResponse.parse(orderResponse(existing)));
        return;
      }
      order = existing;
    }
  }

  if (!order) {
    // Reconciliation is intentionally outside the settings-row transaction:
    // Stripe calls must never hold the lock that serializes new reservations.
    await reconcilePendingPromotionCardOrders();
    try {
      order = await db.transaction(async (tx) => {
        // Every reservation takes this row lock before counting slots. This
        // serializes price selection and prevents two simultaneous requests
        // from both taking the final first-edition slot.
        await tx.execute(sql`SELECT id FROM book_settings WHERE id = 1 FOR UPDATE`);
        const [lockedSettings] = await tx
          .select()
          .from(bookSettingsTable)
          .where(eq(bookSettingsTable.id, 1));
        if (!lockedSettings || lockedSettings.bookObjectPath !== settings.bookObjectPath) {
          throw new OrderConflictError("Store configuration changed. Refresh the checkout page.");
        }
        if (!lockedSettings.salesEnabled || lockedSettings.price <= 0) {
          throw new OrderConflictError("Sales are not currently available");
        }
        if (
          (parsed.data.method === "vodafone" && !lockedSettings.vodafoneCash.trim()) ||
          (parsed.data.method === "instapay" && !lockedSettings.instaPay.trim())
        ) {
          throw new OrderConflictError("Selected payment method is not configured");
        }

        const [existingPendingOrder] = await tx
          .select({ id: bookOrdersTable.id })
          .from(bookOrdersTable)
          .where(
            and(
              eq(bookOrdersTable.clerkUserId, userId),
              eq(bookOrdersTable.status, "pending"),
            ),
          )
          .limit(1);
        if (existingPendingOrder) {
          throw new OrderConflictError(
            "You already have a pending order. Complete or wait for that order before placing another.",
          );
        }

        const [reservationCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bookOrdersTable)
          .where(
            and(
              eq(bookOrdersTable.priceTier, "offer"),
              sql`${bookOrdersTable.status} IN ('pending', 'paid')`,
            ),
          );
        const selectedPrice = selectBookPrice(lockedSettings, reservationCount?.count ?? 0);
        if (
          !expectedPriceMatches(
            selectedPrice,
            parsed.data.expectedAmount,
            parsed.data.expectedCurrency,
          )
        ) {
          throw new OrderConflictError(
            "The displayed price has changed. Refresh the checkout page before continuing.",
          );
        }
        if (parsed.data.method === "card" && !selectedPrice.stripePriceId) {
          throw new OrderConflictError("Card checkout is not configured for the current price");
        }

        if (receiptUpload) {
          const [claimed] = await tx
            .update(bookUploadsTable)
            .set({ usedAt: new Date() })
            .where(and(eq(bookUploadsTable.id, receiptUpload.id), isNull(bookUploadsTable.usedAt)))
            .returning();
          if (!claimed) throw new Error("Receipt upload is already used");
        }
        const [created] = await tx
          .insert(bookOrdersTable)
          .values({
            clerkUserId: userId,
            name: parsed.data.name,
            email: parsed.data.email.toLowerCase(),
            method: parsed.data.method,
            language: parsed.data.language,
            status: "pending",
            amount: selectedPrice.amount,
            currency: selectedPrice.currency,
            priceTier: selectedPrice.tier,
            receiptObjectPath: receiptUpload?.objectPath,
            stripePriceId: parsed.data.method === "card" ? selectedPrice.stripePriceId : null,
            idempotencyKey,
          })
          .returning();
        if (!created) throw new Error("Unable to persist order");
        return created;
      });
    } catch (error) {
      req.log.warn({ err: error }, "Order creation was rejected");
      res.status(409).json({
        error: error instanceof OrderConflictError ? error.message : "Order could not be created",
      });
      return;
    }
  }

  if (order.method === "card") {
    try {
      order = await createOrResumeCardCheckout(order);
    } catch (error) {
      await markDefinitivelyFailedCheckout(error, order);
      req.log.error({ err: error }, "Card checkout could not be created");
      res.status(error instanceof StripeProviderError ? 502 : 503).json({
        error: "Card checkout is temporarily unavailable",
      });
      return;
    }
  }
  res.status(201).json(CreateBookOrderResponse.parse(orderResponse(order)));
});

router.post("/book/orders/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const params = RetryBookCheckoutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;
  const [order] = await db
    .select()
    .from(bookOrdersTable)
    .where(and(eq(bookOrdersTable.id, params.data.id), eq(bookOrdersTable.clerkUserId, userId)));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.method !== "card" || order.status !== "pending") {
    res.status(409).json({ error: "Only pending card orders can resume checkout" });
    return;
  }
  try {
    const resumed = await createOrResumeCardCheckout(order);
    res.json(RetryBookCheckoutResponse.parse(orderResponse(resumed)));
  } catch (error) {
    await markDefinitivelyFailedCheckout(error, order);
    req.log.error({ err: error }, "Card checkout could not be resumed");
    res.status(error instanceof StripeProviderError ? 502 : 503).json({
      error: "Card checkout is temporarily unavailable",
    });
  }
});

router.post("/book/orders/:id/verify", requireAuth, async (req, res): Promise<void> => {
  const params = VerifyBookPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;
  const [order] = await db
    .select()
    .from(bookOrdersTable)
    .where(and(eq(bookOrdersTable.id, params.data.id), eq(bookOrdersTable.clerkUserId, userId)));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.method === "card") {
    try {
      await verifyCardPayment(order);
    } catch (error) {
      req.log.warn({ err: error }, "Stripe payment verification failed");
      res.status(502).json({ error: "Payment verification is temporarily unavailable" });
      return;
    }
  }
  const [fresh] = await db.select().from(bookOrdersTable).where(eq(bookOrdersTable.id, order.id));
  res.json(VerifyBookPaymentResponse.parse(orderResponse(fresh ?? order)));
});

router.get("/book/orders/:id/download", requireAuth, async (req, res): Promise<void> => {
  const params = DownloadBookParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;
  const [order] = await db
    .select()
    .from(bookOrdersTable)
    .where(and(eq(bookOrdersTable.id, params.data.id), eq(bookOrdersTable.clerkUserId, userId)));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.method === "card") {
    try {
      await verifyCardPayment(order);
    } catch (error) {
      req.log.warn({ err: error }, "Stripe download verification failed");
      res.status(502).json({ error: "Payment verification is temporarily unavailable" });
      return;
    }
  }
  const [fresh] = await db.select().from(bookOrdersTable).where(eq(bookOrdersTable.id, order.id));
  if (!fresh || fresh.status !== "paid") {
    res.status(403).json({ error: "Order is not paid" });
    return;
  }
  const settings = await getSettings();
  if (!settings.bookObjectPath) {
    res.status(503).json({ error: "Book is not available" });
    return;
  }
  const bookUpload = await getUpload(settings.bookObjectPath);
  if (!bookUpload || bookUpload.purpose !== "book" || bookUpload.contentType !== "application/pdf") {
    res.status(503).json({ error: "Book is not available" });
    return;
  }
  try {
    await objectStorage.validateUploadedObject(bookUpload.objectPath, {
      size: bookUpload.size,
      contentType: "application/pdf",
    });
    await sendAuthorizedPrivateDownload(
      req,
      res,
      bookUpload.objectPath,
      "aroma-school-ebook.pdf",
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Book is not available" });
      return;
    }
    req.log.error({ err: error }, "Paid book download failed");
    res.status(503).json({ error: "Book is not available" });
  }
});

router.put("/book/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = SaveBookSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings input" });
    return;
  }
  if (parsed.data.offerPrice >= parsed.data.price) {
    res.status(400).json({ error: "The first-edition offer price must be lower than the regular price" });
    return;
  }
  const adminId = (req as Request & { userId: string }).userId;
  const settings = await getSettings();
  const requestedPath = parsed.data.bookObjectPath;
  const bookPath = requestedPath === undefined ? settings.bookObjectPath : requestedPath || null;
  let bookUpload: Awaited<ReturnType<typeof getUpload>> | undefined;
  if (bookPath) {
    bookUpload = await getUpload(bookPath);
    const retainingCurrentPath = bookPath === settings.bookObjectPath;
    if (
      !bookUpload ||
      bookUpload.purpose !== "book" ||
      bookUpload.contentType !== "application/pdf" ||
      (!retainingCurrentPath && (bookUpload.ownerId !== adminId || bookUpload.usedAt))
    ) {
      res.status(400).json({ error: "Book upload is invalid or not owned by this admin" });
      return;
    }
    try {
      await objectStorage.validateUploadedObject(bookPath, {
        size: bookUpload.size,
        contentType: "application/pdf",
      });
    } catch {
      res.status(400).json({ error: "Book upload is incomplete or invalid" });
      return;
    }
  }
  let stripeRefs: { productId: string; priceId: string };
  let stripeOfferRefs: { productId: string; priceId: string };
  try {
    stripeRefs = await createStripeCatalogPrice({
      currentProductId: settings.stripeProductId,
      currentPriceId: settings.stripePriceId,
      price: parsed.data.price,
      currency: parsed.data.currency,
    });
    stripeOfferRefs = await createStripeCatalogPrice({
      currentProductId: stripeRefs.productId,
      currentPriceId: settings.stripeOfferPriceId,
      price: parsed.data.offerPrice,
      currency: parsed.data.currency,
    });
  } catch (error) {
    req.log.error({ err: error }, "Stripe catalog price could not be configured");
    res.status(502).json({ error: "Payment configuration is temporarily unavailable" });
    return;
  }
  const paymentMethodReady =
    parsed.data.vodafoneCash.trim().length > 0 ||
    parsed.data.instaPay.trim().length > 0 ||
    Boolean(stripeRefs.priceId && stripeOfferRefs.priceId);
  if (
    parsed.data.salesEnabled &&
    (!bookPath || !paymentMethodReady || parsed.data.offerPrice <= 0)
  ) {
    res.status(400).json({
      error: "Enabling sales requires a valid price, book PDF, and payment method",
    });
    return;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      if (bookUpload && bookUpload.objectPath !== settings.bookObjectPath) {
        const [claimed] = await tx
          .update(bookUploadsTable)
          .set({ usedAt: new Date() })
          .where(and(eq(bookUploadsTable.id, bookUpload.id), isNull(bookUploadsTable.usedAt)))
          .returning();
        if (!claimed) throw new Error("Book upload is already in use");
      }
      const [saved] = await tx
        .update(bookSettingsTable)
        .set({
          price: parsed.data.price,
          offerPrice: parsed.data.offerPrice,
          offerLimit: parsed.data.offerLimit,
          currency: parsed.data.currency,
          vodafoneCash: parsed.data.vodafoneCash,
          instaPay: parsed.data.instaPay,
          bookObjectPath: bookPath,
          stripeProductId: stripeRefs.productId,
          stripePriceId: stripeRefs.priceId,
          stripeOfferPriceId: stripeOfferRefs.priceId,
          salesEnabled: parsed.data.salesEnabled,
          updatedBy: adminId,
          updatedAt: new Date(),
        })
        .where(eq(bookSettingsTable.id, 1))
        .returning();
      if (!saved) throw new Error("Unable to save settings");
      return saved;
    });
    res.json(SaveBookSettingsResponse.parse(await toPublicSettings()));
  } catch (error) {
    req.log.error({ err: error }, "Book settings save failed");
    res.status(409).json({ error: "Settings could not be saved" });
  }
});

router.get("/book/admin/orders", requireAdmin, async (_req, res): Promise<void> => {
  const orders = await db
    .select()
    .from(bookOrdersTable)
    .where(and(eq(bookOrdersTable.status, "pending"), ne(bookOrdersTable.method, "card")))
    .orderBy(desc(bookOrdersTable.createdAt));
  res.json(ListAdminBookOrdersResponse.parse(orders.map(orderResponse)));
});

router.patch("/book/admin/orders/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = ReviewBookOrderParams.safeParse(req.params);
  const parsed = ReviewBookOrderBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid order review" });
    return;
  }
  const adminId = (req as Request & { userId: string }).userId;
  const [reviewed] = await db
    .update(bookOrdersTable)
    .set({
      status: parsed.data.status,
      reviewNote: parsed.data.reviewNote ?? null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bookOrdersTable.id, params.data.id),
        eq(bookOrdersTable.status, "pending"),
        ne(bookOrdersTable.method, "card"),
      ),
    )
    .returning();
  if (!reviewed) {
    res.status(409).json({ error: "Only pending manual orders can be reviewed" });
    return;
  }
  res.json(ReviewBookOrderResponse.parse(orderResponse(reviewed)));
});

router.get("/book/admin/orders/:id/receipt", requireAdmin, async (req, res): Promise<void> => {
  const params = DownloadReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }
  const [order] = await db
    .select()
    .from(bookOrdersTable)
    .where(eq(bookOrdersTable.id, params.data.id));
  if (!order || order.method === "card" || !order.receiptObjectPath) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  const upload = await getUpload(order.receiptObjectPath);
  if (
    !upload ||
    upload.objectPath !== order.receiptObjectPath ||
    upload.ownerId !== order.clerkUserId ||
    upload.purpose !== "receipt" ||
    !["image/jpeg", "image/png", "application/pdf"].includes(upload.contentType)
  ) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  try {
    await objectStorage.validateUploadedObject(upload.objectPath, {
      size: upload.size,
      contentType: upload.contentType as "image/jpeg" | "image/png" | "application/pdf",
    });
    await sendAuthorizedPrivateDownload(
      req,
      res,
      upload.objectPath,
      upload.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    req.log.error({ err: error }, "Receipt download failed");
    res.status(503).json({ error: "Receipt is unavailable" });
  }
});

export default router;