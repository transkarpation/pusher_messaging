ALTER TABLE "rooms" ADD COLUMN "activity" integer DEFAULT nextval('messages_id_seq') NOT NULL;--> statement-breakpoint
-- Existing rooms: the id of their latest message; a room without messages sorts by when it was
-- created, at the id of the last message posted anywhere before that.
UPDATE "rooms" SET "activity" = coalesce(
  (SELECT max("id") FROM "messages" WHERE "messages"."room_id" = "rooms"."id"),
  (SELECT max("id") FROM "messages" WHERE "messages"."created_at" <= "rooms"."created_at"),
  0
);
