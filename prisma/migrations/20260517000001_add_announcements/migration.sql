-- CreateTable
CREATE TABLE "announcements" (
    "id"        TEXT        NOT NULL,
    "title"     VARCHAR(120) NOT NULL,
    "body"      TEXT        NOT NULL,
    "kind"      VARCHAR(20)  NOT NULL DEFAULT 'notice',
    "pinned"    BOOLEAN      NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcements_createdAt_idx" ON "announcements"("createdAt" DESC);
