-- 소셜 채팅 메시지 테이블
CREATE TABLE social_messages (
  id         BIGSERIAL    PRIMARY KEY,
  "userId"   TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname   VARCHAR(30)  NOT NULL,
  message    VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX social_messages_created_idx ON social_messages("createdAt");
