-- CreateTable
CREATE TABLE "user_records" (
    "userId"          TEXT    NOT NULL,
    "dungeonMaxFloor" INTEGER NOT NULL DEFAULT 0,
    "dungeonMaxKills" INTEGER NOT NULL DEFAULT 0,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_records_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_records" ADD CONSTRAINT "user_records_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
