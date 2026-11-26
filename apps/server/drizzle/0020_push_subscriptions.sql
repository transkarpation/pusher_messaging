CREATE TYPE "public"."push_kind" AS ENUM('web', 'expo');--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"kind" "push_kind" NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text,
	"auth" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");