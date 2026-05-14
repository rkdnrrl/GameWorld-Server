-- CreateTable
CREATE TABLE "activity_logs" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "nickname"  VARCHAR(64) NOT NULL,
    "action"    VARCHAR(32) NOT NULL,
    "detail"    JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_userId_idx"    ON "activity_logs"("userId");
CREATE INDEX "activity_logs_action_idx"    ON "activity_logs"("action");
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt" DESC);
