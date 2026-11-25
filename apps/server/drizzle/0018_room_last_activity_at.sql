ALTER TABLE "rooms" ADD COLUMN "last_activity_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- When each room's latest message was posted, or when the room was created if it has none.
UPDATE "rooms" SET "last_activity_at" = coalesce(
  (SELECT max("created_at") FROM "messages" WHERE "messages"."room_id" = "rooms"."id"),
  "rooms"."created_at"
);--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "activity";
