-- 게임 카테고리(장르) 테이블 신규 생성
CREATE TABLE game_genres (
  slug        VARCHAR(50)  PRIMARY KEY,
  "labelKo"   VARCHAR(50)  NOT NULL,
  "labelEn"   VARCHAR(50)  NOT NULL,
  emoji       VARCHAR(10)  NOT NULL DEFAULT '🎮',
  "sortOrder" INTEGER      NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- games 테이블에 genre 컬럼 추가 (nullable — 기존 게임은 미설정)
ALTER TABLE games ADD COLUMN IF NOT EXISTS genre VARCHAR(50);
