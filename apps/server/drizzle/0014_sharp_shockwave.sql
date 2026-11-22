CREATE TABLE "room_avatars" (
	"room_id" integer PRIMARY KEY NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_avatars" ADD CONSTRAINT "room_avatars_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;