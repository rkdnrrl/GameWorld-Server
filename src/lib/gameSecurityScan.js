'use strict';
/**
 * 커뮤니티 게임 업로드 정적 코드 스캔.
 *
 * zip 안 HTML/JS 텍스트를 정규식으로 훑어 위험 패턴을 줄번호·심각도와 함께 수집한다.
 * 결과는 업로드 응답 + activity log + 운영자 재조회 엔드포인트로 노출되며, **차단하지 않는다**
 * (정책: 기록만 → 운영자 판단).
 *
 * ⚠️ 이건 보안 경계가 아니라 모더레이션 보조 신호다.
 *    실제 방어는 origin 격리(play.airliveplay.com 별도 도메인) + iframe sandbox + API 게이트.
 *    정상 커뮤니티 게임도 localStorage/fetch/postMessage 를 쓰므로 무조건 차단하면 멀쩡한 게임이 깨진다.
 */

// 스캔 대상 — 텍스트 코드 파일만
const TEXT_EXT = /\.(html?|js|mjs|cjs|jsx)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 파일당 2MB 초과분은 앞부분만 (거대 minified 폭주 방지)
const MAX_FINDINGS   = 300;             // 전체 finding 상한
const SNIPPET_MAX    = 160;

/**
 * 패턴 정의. re 는 줄 단위로 .match() 하므로 global 플래그 없이 둔다.
 * severity: 'critical' | 'warn' | 'info'
 */
const PATTERNS = [
  // ── CRITICAL: 프레임 탈출 / 플랫폼 침범 / 난독화 ──
  { id: 'frame-escape-parent', severity: 'critical',
    re: /\bwindow\.parent\b|\bparent\.(location|document|postMessage|frames|top|window|name)\b/,
    desc: '부모 프레임 접근(window.parent) — 플랫폼 페이지 침범 시도 가능' },
  { id: 'frame-escape-top', severity: 'critical',
    re: /\bwindow\.top\b|\btop\.(location|document|postMessage|frames|name)\b/,
    desc: '최상위 프레임 접근(top) — 프레임 탈출 시도 가능' },
  { id: 'top-navigation', severity: 'critical',
    re: /allow-top-navigation/,
    desc: 'iframe top-navigation 허용 — 플랫폼 페이지 강제 이동 가능' },
  { id: 'obfuscated-eval', severity: 'critical',
    re: /eval\s*\(\s*(atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(/,
    desc: '난독화된 eval (eval+atob 등) — 숨겨진 코드 실행' },
  { id: 'dynamic-function', severity: 'critical',
    re: /\bnew\s+Function\s*\(/,
    desc: 'new Function() 동적 코드 생성 — 난독화·우회 위험' },
  { id: 'document-cookie', severity: 'critical',
    re: /document\.cookie/,
    desc: 'document.cookie 접근 — 세션/토큰 탈취 시도 가능' },

  // ── WARN: 동적 실행 / 외부 통신 / 마이너 ──
  { id: 'eval', severity: 'warn',
    re: /\beval\s*\(/,
    desc: 'eval() 동적 실행' },
  { id: 'platform-api', severity: 'warn',
    re: /api\.airliveplay\.com|airliveplay\.com\/api/,
    desc: '플랫폼 API 호출 시도 — 커뮤니티 게임은 코인/인벤토리 API 가 차단됨' },
  { id: 'crypto-miner', severity: 'warn',
    re: /coinhive|cryptonight|webminerpool|coinimp|deepminer|minero\b/i,
    desc: '암호화폐 마이너 의심 키워드' },
  { id: 'send-beacon', severity: 'warn',
    re: /navigator\.sendBeacon/,
    desc: 'sendBeacon — 백그라운드 데이터 전송' },
  { id: 'post-message', severity: 'warn',
    re: /\.postMessage\s*\(/,
    desc: 'postMessage — 프레임 간 메시지 (origin 검증 확인 필요)' },

  // ── INFO: 정상이지만 참고용 ──
  { id: 'external-script', severity: 'info',
    re: /<script[^>]+src\s*=\s*["']https?:\/\//i,
    desc: '외부 스크립트 로드' },
  { id: 'external-iframe', severity: 'info',
    re: /<iframe[^>]+src\s*=\s*["']https?:\/\//i,
    desc: '외부 iframe 삽입' },
  { id: 'local-storage', severity: 'info',
    re: /\b(localStorage|indexedDB)\b/,
    desc: '로컬 저장소 사용 (정상)' },
];

/** 한 텍스트 파일을 줄 단위로 스캔해 findings 에 push. */
function scanText(name, text, findings) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= MAX_FINDINGS) return;
    const line = lines[i];
    if (!line) continue;
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 40);
      findings.push({
        file: name,
        line: i + 1,
        severity: p.severity,
        id: p.id,
        desc: p.desc,
        snippet: line.slice(start, start + SNIPPET_MAX).trim(),
      });
      if (findings.length >= MAX_FINDINGS) return;
    }
  }
}

/**
 * 게임 파일 묶음을 스캔한다.
 * @param {{name:string, data:Buffer}[]} files
 * @returns {{scannedAt, scannedFiles, totalFindings, counts, maxSeverity, findings}}
 */
function scanGameFiles(files) {
  const findings = [];
  let scannedFiles = 0;
  for (const f of files || []) {
    if (!f || !TEXT_EXT.test(f.name) || !f.data) continue;
    if (findings.length >= MAX_FINDINGS) break;
    scannedFiles++;
    const buf = f.data.length > MAX_FILE_BYTES ? f.data.subarray(0, MAX_FILE_BYTES) : f.data;
    let text;
    try { text = buf.toString('utf8'); } catch { continue; }
    scanText(f.name, text, findings);
  }
  const counts = { critical: 0, warn: 0, info: 0 };
  for (const fd of findings) counts[fd.severity]++;
  const maxSeverity = counts.critical ? 'critical' : counts.warn ? 'warn' : counts.info ? 'info' : 'none';
  return { scannedFiles, totalFindings: findings.length, counts, maxSeverity, findings };
}

/** activity log·응답용 경량 요약 (full findings 대신 상위 N건만). */
function summarizeScan(scan, topN = 20) {
  if (!scan) return null;
  const ranked = [...scan.findings].sort(
    (a, b) => sevRank(b.severity) - sevRank(a.severity),
  );
  return {
    counts: scan.counts,
    maxSeverity: scan.maxSeverity,
    totalFindings: scan.totalFindings,
    top: ranked.slice(0, topN),
  };
}

function sevRank(s) { return s === 'critical' ? 3 : s === 'warn' ? 2 : s === 'info' ? 1 : 0; }

module.exports = { scanGameFiles, summarizeScan, TEXT_EXT };
