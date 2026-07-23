CREATE TYPE "platformAiProvider" AS ENUM('vertex');--> statement-breakpoint
CREATE TABLE "PlatformAiSetting" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"provider" "platformAiProvider" DEFAULT 'vertex'::"platformAiProvider" NOT NULL,
	"chatModel" text NOT NULL,
	"embeddingModel" text NOT NULL,
	"location" text NOT NULL,
	"fallbackModel" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updatedByUserId" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX "PlatformAiSetting_provider_key" ON "PlatformAiSetting" ("provider");--> statement-breakpoint
ALTER TABLE "PlatformAiSetting" ADD CONSTRAINT "PlatformAiSetting_updatedByUserId_User_id_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL;