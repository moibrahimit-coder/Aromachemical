import { createInsertSchema } from "drizzle-zod";
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const bookOrdersTable = pgTable(
  "book_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    method: text("method").notNull(),
    language: text("language").notNull(),
    status: text("status").notNull().default("pending"),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    priceTier: text("price_tier").notNull().default("regular"),
    receiptObjectPath: text("receipt_object_path"),
    stripePriceId: text("stripe_price_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    checkoutUrl: text("checkout_url"),
    idempotencyKey: text("idempotency_key"),
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerIndex: index("book_orders_owner_idx").on(table.clerkUserId, table.createdAt),
    statusIndex: index("book_orders_status_idx").on(table.status, table.method),
    ownerIdempotencyIndex: uniqueIndex("book_orders_owner_idempotency_idx").on(
      table.clerkUserId,
      table.idempotencyKey,
    ),
    // A buyer may resume their single pending payment, but cannot occupy
    // multiple promotional reservations with repeated checkout attempts.
    ownerPendingOrderIndex: uniqueIndex("book_orders_one_pending_per_owner_idx")
      .on(table.clerkUserId)
      .where(sql`${table.status} = 'pending'`),
  }),
);

export const insertBookOrderSchema = createInsertSchema(bookOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
});
export type InsertBookOrder = z.infer<typeof insertBookOrderSchema>;
export type BookOrder = typeof bookOrdersTable.$inferSelect;