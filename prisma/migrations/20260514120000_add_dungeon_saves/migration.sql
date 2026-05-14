-- CreateTable
CREATE TABLE "dungeon_saves" (
    "userId"  TEXT NOT NULL,
    "data"    JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dungeon_saves_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "dungeon_saves" ADD CONSTRAINT "dungeon_saves_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
