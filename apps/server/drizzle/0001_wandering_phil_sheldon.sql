CREATE TABLE "receipts" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"delivered_up_to" integer DEFAULT 0 NOT NULL,
	"read_up_to" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;