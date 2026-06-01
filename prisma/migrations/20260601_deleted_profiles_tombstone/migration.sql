-- 탈퇴한 계정의 묘비. DELETE /api/auth/me 시 기록됨.
-- 미들웨어가 이 id 의 토큰을 401 로 거부 → routes 의 prisma.profile.upsert() 가 다시 만드는 부활 차단.
-- 운영자가 row 수동 삭제하면 그 id 재가입 가능 (수동 unban 패턴).

CREATE TABLE IF NOT EXISTS deleted_profiles (
  id                TEXT PRIMARY KEY,
  "deletedAt"       TIMESTAMPTZ DEFAULT NOW(),
  "originalUsername" TEXT,
  email             TEXT
);

CREATE INDEX IF NOT EXISTS deleted_profiles_email_idx ON deleted_profiles (email);
