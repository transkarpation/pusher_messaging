CREATE TYPE "public"."room_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "room_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_members_user_id_idx" ON "room_members" USING btree ("user_id");--> statement-breakpoint

-- Data migration: the former single chat becomes a "General" room with every existing
-- user as a member (the oldest user owns it). Skipped on an empty database.
INSERT INTO "rooms" ("name", "created_by")
SELECT 'General', min("id") FROM "users" HAVING count(*) > 0;--> statement-breakpoint
INSERT INTO "room_members" ("room_id", "user_id", "role")
SELECT r."id", u."id", CASE WHEN u."id" = r."created_by" THEN 'owner'::room_role ELSE 'member'::room_role END
FROM "users" u CROSS JOIN (SELECT "id", "created_by" FROM "rooms" ORDER BY "id" LIMIT 1) r;--> statement-breakpoint

ALTER TABLE "messages" ADD COLUMN "room_id" integer;--> statement-breakpoint
UPDATE "messages" SET "room_id" = (SELECT "id" FROM "rooms" ORDER BY "id" LIMIT 1);--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "room_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP INDEX "messages_created_at_idx";--> statement-breakpoint
CREATE INDEX "messages_room_id_id_idx" ON "messages" USING btree ("room_id","id");--> statement-breakpoint

ALTER TABLE "receipts" ADD COLUMN "room_id" integer;--> statement-breakpoint
UPDATE "receipts" SET "room_id" = (SELECT "id" FROM "rooms" ORDER BY "id" LIMIT 1);--> statement-breakpoint
ALTER TABLE "receipts" ALTER COLUMN "room_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_pkey";--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_room_id_user_id_pk" PRIMARY KEY("room_id","user_id");--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;
