-- 자유게시판 게시물
CREATE TABLE community_posts (
  id          TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  content     TEXT NOT NULL,
  category    VARCHAR(20) NOT NULL DEFAULT 'free',
  views       INTEGER NOT NULL DEFAULT 0,
  "isPinned"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX community_posts_user_idx     ON community_posts("userId");
CREATE INDEX community_posts_cat_date_idx ON community_posts(category, "createdAt" DESC);
CREATE INDEX community_posts_date_idx     ON community_posts("createdAt" DESC);

-- 자유게시판 댓글
CREATE TABLE community_comments (
  id          BIGSERIAL PRIMARY KEY,
  "postId"    TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  "userId"    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX community_comments_post_idx ON community_comments("postId", "createdAt");
