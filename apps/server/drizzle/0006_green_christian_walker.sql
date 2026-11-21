CREATE TYPE "public"."message_kind" AS ENUM('text', 'member_joined');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" "message_kind" DEFAULT 'text' NOT NULL;