-- UGC 게임 (공식 + 커뮤니티) + 신고 + 커뮤니티 게임 격리 데이터

CREATE TABLE "games" (
  "slug"          VARCHAR(60)  PRIMARY KEY,
  "ownerUserId"   TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "title"         VARCHAR(120) NOT NULL,
  "description"   VARCHAR(2000),
  "emoji"         VARCHAR(16)  NOT NULL DEFAULT '🎮',
  "kind"          VARCHAR(20)  NOT NULL DEFAULT 'community', -- 'official' | 'community'
  "status"        VARCHAR(20)  NOT NULL DEFAULT 'pending',   -- 'pending' | 'published' | 'rejected' | 'hidden'
  "category"      VARCHAR(20)  NOT NULL DEFAULT 'other',     -- 'earn' | 'multiplay' | 'decorate' | 'other'
  "storagePath"   VARCHAR(200) NOT NULL,                     -- 'games/{slug}/'
  "externalUrl"   VARCHAR(400),                              -- 공식 외부 URL (호환용)
  "thumbnailUrl"  VARCHAR(400),
  "screenshots"   JSONB,
  "tags"          JSONB,
  "statusUrl"     VARCHAR(400),                              -- 멀티 상태 조회용
  "maxPlayers"    INT,
  "playCount"     INT          NOT NULL DEFAULT 0,
  "likeCount"     INT          NOT NULL DEFAULT 0,
  "version"       INT          NOT NULL DEFAULT 1,
  "rejectReason"  VARCHAR(500),
  "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "publishedAt"   TIMESTAMPTZ
);

CREATE INDEX "games_status_kind_idx"   ON "games" ("status", "kind");
CREATE INDEX "games_ownerUserId_idx"   ON "games" ("ownerUserId");

CREATE TABLE "game_reports" (
  "id"              BIGSERIAL    PRIMARY KEY,
  "gameSlug"        VARCHAR(60)  NOT NULL REFERENCES "games"("slug") ON DELETE CASCADE,
  "reporterUserId"  TEXT,
  "reason"          VARCHAR(60)  NOT NULL,
  "detail"          VARCHAR(1000),
  "resolved"        BOOLEAN      NOT NULL DEFAULT FALSE,
  "createdAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "game_reports_gameSlug_resolved_idx"
  ON "game_reports" ("gameSlug", "resolved");

CREATE TABLE "community_game_data" (
  "gameSlug"   VARCHAR(60) NOT NULL,
  "userId"     TEXT        NOT NULL,
  "data"       JSONB       NOT NULL,
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("gameSlug", "userId")
);

CREATE INDEX "community_game_data_userId_idx"
  ON "community_game_data" ("userId");

-- 기존 정적 config 의 공식 게임 5개 시드 (DB 기반 운영으로 마이그레이션)
INSERT INTO "games" ("slug", "title", "description", "emoji", "kind", "status", "category",
                    "storagePath", "externalUrl", "tags", "statusUrl", "maxPlayers",
                    "publishedAt") VALUES
  ('space-fishing',     '폐품 낚시',         '폐기장과 오염된 강에서 희귀한 폐품을 건져 올리세요!',
   '🎣', 'official', 'published', 'earn',
   'games/space-fishing/',    'http://13.125.187.132/space-fishing',
   '["싱글플레이","낚시"]'::jsonb, NULL, NULL, NOW()),

  ('blacksmith',        '대장간',           '모루와 불길 앞에서 재료를 맞물려, 장비를 제련하세요.',
   '⚒️', 'official', 'published', 'earn',
   'games/blacksmith/',       'http://13.125.187.132/blacksmith',
   '["싱글플레이","조합","제작","중세"]'::jsonb, NULL, NULL, NOW()),

  ('dungeon',           '던전 탐험',         '대장간에서 만든 장비를 들고 던전에 뛰어드세요.',
   '⚔️', 'official', 'published', 'earn',
   'games/dungeon/',          'http://13.125.187.132/dungeon',
   '["싱글플레이","던전","액션","장비"]'::jsonb, NULL, NULL, NOW()),

  ('alchemy',           '연금술',           '추출 원소를 조합해 새 산출물을 만들거나, 재료를 분해해 원소를 모으세요.',
   '🧪', 'official', 'published', 'earn',
   'games/alchemy/',          'http://13.125.187.132/alchemy',
   '["싱글플레이","조합","연금술","분해"]'::jsonb, NULL, NULL, NOW()),

  ('cube-multiplay',    '큐브 멀티플레이',   '친구들과 함께 즐기는 실시간 멀티플레이 큐브 게임',
   '🎲', 'official', 'published', 'multiplay',
   'games/cube-multiplay/',   'http://13.125.187.132/multiplay-game1',
   '["멀티플레이","실시간"]'::jsonb,
   'http://13.125.187.132/status', 100, NOW()),

  ('topdown-multiplay', '탑다운 멀티플레이', '친구들과 함께 즐기는 탑다운 시점 멀티플레이 게임',
   '🎮', 'official', 'published', 'multiplay',
   'games/topdown-multiplay/','http://13.125.187.132/multiplay-game2',
   '["멀티플레이","실시간"]'::jsonb,
   'http://13.125.187.132/multiplay-game2/status', 100, NOW()),

  ('interior-3d',       '3D 인테리어 방',    '가구를 사서 방을 3D로 꾸며 보세요.',
   '🏠', 'official', 'published', 'decorate',
   'games/interior-3d/',      'http://13.125.187.132/interior1',
   '["싱글플레이","꾸미기"]'::jsonb, NULL, NULL, NOW());
