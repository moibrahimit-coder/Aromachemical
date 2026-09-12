import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const bookUploadsTable = pgTable(
  "book_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objectPath: text("object_path").notNull().unique(),
    ownerId: text("owner_id").notNull(),
    purpose: text("purpose").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerPurposeIndex: index("book_uploads_owner_purpose_idx").on(
      table.ownerId,
      table.purpose,
    ),
  }),
);

export const insertBookUploadSchema = createInsertSchema(bookUploadsTable).omit({
  id: true,
  createdAt: true,
  usedAt: true,
});
export type InsertBookUpload = z.infer<typeof insertBookUploadSchema>;
export type BookUpload = typeof bookUploadsTable.$inferSelect;