-- DM 1:1 채팅 (Phase 19). Supabase SQL Editor 에서 직접 실행.

-- 1. conversations — 두 유저 사이의 대화방
-- userA / userB 는 정렬 (작은 id 가 userA) 해서 중복 방지
CREATE TABLE IF NOT EXISTS dm_conversations (
  id            TEXT PRIMARY KEY,
  "userAId"     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  "userBId"     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  "lastMessageAt" TIMESTAMPTZ,
  "lastMessageText" TEXT,
  "lastSenderId" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dm_conv_unique UNIQUE ("userAId", "userBId"),
  CONSTRAINT dm_conv_ordered CHECK ("userAId" < "userBId")
);
CREATE INDEX IF NOT EXISTS idx_dm_conv_userA ON dm_conversations("userAId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS idx_dm_conv_userB ON dm_conversations("userBId", "lastMessageAt" DESC);

-- 2. messages
CREATE TABLE IF NOT EXISTS dm_messages (
  id              TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  "senderId"      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "readAt"        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dm_msg_conv ON dm_messages("conversationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_dm_msg_unread ON dm_messages("conversationId") WHERE "readAt" IS NULL;

-- 3. Supabase Realtime — dm_messages 테이블에 row INSERT 시 구독자에게 푸시
-- 다음 명령은 Supabase Realtime 활성화 (대시보드에서 ENABLE 또는 SQL 로):
ALTER PUBLICATION supabase_realtime ADD TABLE dm_messages;
