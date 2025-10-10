-- AlterTable: add analysis column to facial_landmarks
ALTER TABLE "facial_landmarks" ADD COLUMN IF NOT EXISTS "analysis" JSONB;

