ALTER TYPE "public"."message_kind" ADD VALUE 'poll';--> statement-breakpoint
CREATE TABLE "poll_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"text" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"text" varchar(100) NOT NULL,
	"position" smallint NOT NULL,
	"added_by" integer
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"option_id" integer NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_option_id_user_id_pk" PRIMARY KEY("option_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"message_id" integer PRIMARY KEY NOT NULL,
	"question" varchar(300) NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"max_votes" smallint,
	"anonymous" boolean DEFAULT false NOT NULL,
	"allow_suggestions" boolean DEFAULT false NOT NULL,
	"allow_comments" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_comments" ADD CONSTRAINT "poll_comments_message_id_polls_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."polls"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_comments" ADD CONSTRAINT "poll_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_message_id_polls_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."polls"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_message_id_polls_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."polls"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_comments_message_id_idx" ON "poll_comments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "poll_options_message_id_idx" ON "poll_options" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "poll_votes_message_id_idx" ON "poll_votes" USING btree ("message_id","user_id");