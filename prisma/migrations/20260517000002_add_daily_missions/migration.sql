-- CreateTable
CREATE TABLE "daily_mission_progress" (
    "userId"      TEXT    NOT NULL,
    "date"        DATE    NOT NULL,   -- KST 기준 날짜 (YYYY-MM-DD)
    "missionId"   VARCHAR(32) NOT NULL,
    "progress"    INTEGER NOT NULL DEFAULT 0,
    "completed"   BOOLEAN NOT NULL DEFAULT false,
    "rewardPaid"  BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "daily_mission_progress_pkey" PRIMARY KEY ("userId", "date", "missionId")
);

-- AddForeignKey
ALTER TABLE "daily_mission_progress" ADD CONSTRAINT "daily_mission_progress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "daily_mission_progress_userId_date_idx" ON "daily_mission_progress"("userId", "date");
