-- game_ratings: 유저별 게임 별점 (1~5)
CREATE TABLE IF NOT EXISTS game_ratings (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  game_slug  VARCHAR(60) NOT NULL REFERENCES games(slug)     ON DELETE CASCADE,
  rating     INTEGER     NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_slug)
);

CREATE INDEX IF NOT EXISTS idx_game_ratings_slug ON game_ratings (game_slug);
