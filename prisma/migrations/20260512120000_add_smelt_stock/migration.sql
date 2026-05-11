-- CreateTable
CREATE TABLE "smelt_stock" (
    "userId" TEXT NOT NULL,
    "productId" VARCHAR(32) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smelt_stock_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateIndex
CREATE INDEX "smelt_stock_userId_idx" ON "smelt_stock"("userId");

-- AddForeignKey
ALTER TABLE "smelt_stock" ADD CONSTRAINT "smelt_stock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
