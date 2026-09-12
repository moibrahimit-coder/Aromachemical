import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const bookSettingsTable = pgTable("book_settings", {
  id: integer("id").primaryKey().default(1),
  price: numeric("price", { precision: 12, scale: 2, mode: "number" }),
  currency: text("currency").notNull().default("egp"),
  vodafoneCash: text("vodafone_cash").notNull().default(""),
  instaPay: text("insta_pay").notNull().default(""),
  bookObjectPath: text("book_object_path"),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  salesEnabled: boolean("sales_enabled").notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBookSettingsSchema = createInsertSchema(bookSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertBookSettings = z.infer<typeof insertBookSettingsSchema>;
export type BookSettings = typeof bookSettingsTable.$inferSelect;