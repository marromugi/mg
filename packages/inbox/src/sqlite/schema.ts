import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const inboxItems = sqliteTable("inbox_items", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  conversationId: text("conversation_id").notNull(),
  input: text("input").notNull(),
  dueAt: integer("due_at").notNull(),
  addedAt: integer("added_at").notNull(),
  outcome: text("outcome"),
  reason: text("reason"),
});
