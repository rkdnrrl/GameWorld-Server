-- CreateTable: voxel_objects
CREATE TABLE "voxel_objects" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "name"      VARCHAR(50) NOT NULL,
    "price"     INTEGER NOT NULL,
    "voxels"    JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voxel_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable: voxel_placements
CREATE TABLE "voxel_placements" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "voxelObjectId" TEXT NOT NULL,
    "posX"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posZ"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotY"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "placedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voxel_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voxel_objects_userId_idx" ON "voxel_objects"("userId");
CREATE INDEX "voxel_placements_userId_idx" ON "voxel_placements"("userId");

-- AddForeignKey
ALTER TABLE "voxel_objects" ADD CONSTRAINT "voxel_objects_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voxel_placements" ADD CONSTRAINT "voxel_placements_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voxel_placements" ADD CONSTRAINT "voxel_placements_voxelObjectId_fkey"
    FOREIGN KEY ("voxelObjectId") REFERENCES "voxel_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
