/**
 * 정적 official 게임 목록.
 *
 * 옛 게임용 Lightsail (13.125.187.132) 폐기에 맞춰 비움.
 * 이전 데이터는 git 히스토리에 보존됨 — 살리고 싶은 게임은
 * 새 인프라(R2 + Worker)로 zip 업로드 후 DB games 테이블에
 * kind='official', status='published' 로 INSERT.
 */
module.exports = [];
