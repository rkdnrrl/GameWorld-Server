-- CreateTable
CREATE TABLE "alchemy_element_stock" (
    "userId" TEXT NOT NULL,
    "symbol" VARCHAR(8) NOT NULL,
    "nameKo" VARCHAR(40),
    "atomicNumber" INTEGER,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alchemy_element_stock_pkey" PRIMARY KEY ("userId","symbol")
);

-- CreateIndex
CREATE INDEX "alchemy_element_stock_userId_idx" ON "alchemy_element_stock"("userId");

-- AddForeignKey
ALTER TABLE "alchemy_element_stock" ADD CONSTRAINT "alchemy_element_stock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
