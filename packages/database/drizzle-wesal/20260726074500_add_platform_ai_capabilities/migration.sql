ALTER TABLE "PlatformAiSetting"
  ADD COLUMN IF NOT EXISTS "capabilities" jsonb;
--> statement-breakpoint
UPDATE "PlatformAiSetting"
SET
  "chatModel" = 'gemini-3.1-flash-lite',
  "fallbackModel" = 'gemini-2.5-flash',
  "location" = 'global',
  "capabilities" = COALESCE(
    "capabilities",
    '{
      "vision":{"provider":"vertex","model":"gemini-2.5-pro","fallbackModel":"gemini-2.5-flash","location":"global"},
      "embedding":{"provider":"vertex","model":"text-embedding-005","location":"global"},
      "summarization":{"provider":"vertex","model":"gemini-3.1-flash-lite","fallbackModel":"gemini-2.5-flash","location":"global"},
      "extraction":{"provider":"vertex","model":"gemini-2.5-pro","fallbackModel":"gemini-2.5-flash","location":"global"},
      "imageGeneration":{"provider":"vertex","model":"imagen-4.0-ultra-generate-001","fallbackModel":"imagen-4.0-generate-001","location":"us-central1"},
      "imageEditing":{"provider":"vertex","model":"gemini-3.1-flash-image","fallbackModel":"gemini-2.5-flash-image","location":"global"},
      "speechToText":{"provider":"vertex","model":"chirp_3","fallbackModel":"chirp_2","location":"us"},
      "textToSpeech":{"provider":"googleCloud","model":"chirp3-hd","location":"global","voice":"ar-XA-Chirp3-HD-Aoede"},
      "webSearch":{"provider":"vertex","model":"gemini-2.5-flash","location":"global"},
      "documentParsing":{"provider":"local","model":"builtin-layout-parser"},
      "translation":{"provider":"googleCloud","model":"translation-llm","location":"global"}
    }'::jsonb
  )
WHERE "provider" = 'vertex';
