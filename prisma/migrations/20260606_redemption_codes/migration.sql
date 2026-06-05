-- 후원자 보상 코드 (텀블벅 등 외부 결제 후원자 → ALP supporter tier 자동 부여)
CREATE TABLE "redemption_codes" (
  "id"            TEXT         NOT NULL,
  "code"          VARCHAR(20)  NOT NULL,
  "tier"          VARCHAR(20)  NOT NULL,
  "batchLabel"    VARCHAR(100),
  "usedByUserId"  TEXT,
  "usedAt"        TIMESTAMP(3),
  "expiresAt"     TIMESTAMP(3),
  "revoked"       BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "redemption_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "redemption_codes_code_key" ON "redemption_codes"("code");
CREATE INDEX "redemption_codes_batchLabel_idx" ON "redemption_codes"("batchLabel");
CREATE INDEX "redemption_codes_usedByUserId_idx" ON "redemption_codes"("usedByUserId");
