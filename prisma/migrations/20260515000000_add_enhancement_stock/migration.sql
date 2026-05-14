-- CreateTable
CREATE TABLE "enhancement_stock" (
    "userId"    TEXT         NOT NULL,
    "itemType"  VARCHAR(32)  NOT NULL,
    "count"     INTEGER      NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enhancement_stock_pkey" PRIMARY KEY ("userId", "itemType")
);

-- CreateIndex
CREATE INDEX "enhancement_stock_userId_idx" ON "enhancement_stock"("userId");

-- AddForeignKey
ALTER TABLE "enhancement_stock"
    ADD CONSTRAINT "enhancement_stock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
