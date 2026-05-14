-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "moduleType" VARCHAR(32) NOT NULL,
    "tier" VARCHAR(20) NOT NULL DEFAULT 'common',
    "keywords" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "durability" INTEGER NOT NULL DEFAULT 25,
    "durabilityMax" INTEGER NOT NULL DEFAULT 25,
    "equippedTo" VARCHAR(50),
    "equippedSlot" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modules_userId_idx" ON "modules"("userId");

-- CreateIndex
CREATE INDEX "modules_equippedTo_idx" ON "modules"("equippedTo");

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
