-- CreateTable: shared_pixel_arts
-- 일반·희귀 아이템의 AI 픽셀아트 공유 캐시 (이름이 PK)
CREATE TABLE "shared_pixel_arts" (
    "name"      VARCHAR(100) NOT NULL,
    "imageData" TEXT         NOT NULL,
    "rarity"    VARCHAR(20)  NOT NULL,
    "type"      VARCHAR(20)  NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_pixel_arts_pkey" PRIMARY KEY ("name")
);
