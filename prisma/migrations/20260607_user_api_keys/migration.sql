-- 유저 개인 외부 API 키 (OpenAI, Anthropic 등) — AES-256-GCM 암호화 저장.
-- 다른 디바이스 sync 용. 본인만 조회/수정 가능.

CREATE TABLE IF NOT EXISTS user_api_keys (
  id            TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service       VARCHAR(40) NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  iv            TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_user_service_key ON user_api_keys("userId", service);
CREATE INDEX IF NOT EXISTS user_api_keys_user_idx ON user_api_keys("userId");
