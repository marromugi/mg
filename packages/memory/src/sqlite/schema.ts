import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const personas = sqliteTable("personas", {
  id: text("id").primaryKey(),
  personaText: text("persona_text").notNull(),
  personaVersion: integer("persona_version").notNull(),
});

export const summaries = sqliteTable(
  "summaries",
  {
    personaId: text("persona_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    text: text("text").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.personaId, table.conversationId] }),
  ],
);

export const items = sqliteTable(
  "items",
  {
    personaId: text("persona_id").notNull(),
    id: text("id").notNull(),
    counterpart: text("counterpart").notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
    misses: integer("misses").notNull(),
    seq: integer("seq").notNull(),
  },
  (table) => [primaryKey({ columns: [table.personaId, table.id] })],
);
