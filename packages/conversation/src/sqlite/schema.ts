import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
});

export const entries = sqliteTable(
  "entries",
  {
    conversationId: text("conversation_id").notNull(),
    position: integer("position").notNull(),
    messages: text("messages").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.position] }),
  ],
);
