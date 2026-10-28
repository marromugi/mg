import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const replies = sqliteTable("replies", {
  cursor: integer("cursor").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull(),
  inputId: text("input_id").notNull(),
  kind: text("kind").notNull(),
  text: text("text"),
  reason: text("reason"),
});
