-- 보상형 광고 시청 로그 (쿨다운·일일한도 체크용)
CREATE TABLE "ad_rewards" (
  "id"            BIGSERIAL PRIMARY KEY,
  "userId"        TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rewardType"    VARCHAR(40) NOT NULL,
  "coinsGranted"  INT NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "ad_rewards_userId_rewardType_createdAt_idx"
  ON "ad_rewards" ("userId", "rewardType", "createdAt");
