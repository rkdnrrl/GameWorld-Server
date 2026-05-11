-- CreateTable
CREATE TABLE "crafted_equipment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipeId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "itemEmoji" VARCHAR(16) NOT NULL DEFAULT '⚔️',
    "tier" VARCHAR(20) NOT NULL DEFAULT 'common',
    "desc" VARCHAR(400),
    "stats" JSONB NOT NULL,
    "sourceCatchIds" JSONB NOT NULL,
    "pixelArt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crafted_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crafted_equipment_userId_idx" ON "crafted_equipment"("userId");

-- AddForeignKey
ALTER TABLE "crafted_equipment" ADD CONSTRAINT "crafted_equipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
