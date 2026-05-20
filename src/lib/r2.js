/**
 * Cloudflare R2 클라이언트 (S3 호환 SDK 사용).
 *
 * .env 에 필요한 변수:
 *   R2_ACCOUNT_ID         — CF 계정 ID (CF 대시보드 우측 사이드바에서 복사)
 *   R2_ACCESS_KEY_ID      — R2 API token 의 Access Key
 *   R2_SECRET_ACCESS_KEY  — R2 API token 의 Secret
 *   R2_BUCKET             — 기본 'alp-games'
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET     = process.env.R2_BUCKET || 'alp-games';

let _client = null;
function client() {
  if (_client) return _client;
  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
    throw new Error('R2 환경변수 누락: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  return _client;
}

const MIME = {
  html: 'text/html; charset=utf-8',
  js:   'application/javascript; charset=utf-8',
  mjs:  'application/javascript; charset=utf-8',
  css:  'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg:  'image/svg+xml',
  png:  'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  mp3:  'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4:  'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  txt:  'text/plain; charset=utf-8',
};
function contentType(key) {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME[key.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
}

async function putObject(key, body, opts = {}) {
  await client().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body,
    ContentType: opts.contentType || contentType(key),
  }));
}

async function deletePrefix(prefix) {
  // R2 에서 prefix 하위 객체들 전부 삭제 (게임 파일 교체/제거 시)
  let token = undefined;
  do {
    const list = await client().send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    if (!list.Contents || list.Contents.length === 0) break;
    await client().send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: list.Contents.map((c) => ({ Key: c.Key })) },
    }));
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
}

module.exports = { putObject, deletePrefix, contentType, BUCKET };
