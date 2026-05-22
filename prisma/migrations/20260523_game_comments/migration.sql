CREATE TABLE IF NOT EXISTS game_comments (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    TEXT         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  game_slug  VARCHAR(60)  NOT NULL REFERENCES games(slug)  ON DELETE CASCADE,
  nickname   VARCHAR(100) NOT NULL DEFAULT '',
  content    VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_comments_slug ON game_comments (game_slug, created_at DESC);
