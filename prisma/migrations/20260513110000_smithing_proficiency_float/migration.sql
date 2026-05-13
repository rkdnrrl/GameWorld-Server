-- smithingProficiency: Int → Float (DOUBLE PRECISION)
-- 기존 정수 값은 자동으로 float 로 변환됩니다.
ALTER TABLE "users"
  ALTER COLUMN "smithingProficiency" TYPE DOUBLE PRECISION;
