const COMMON_API = 'https://api.airnuri.com';

/**
 * 공통 API 유저 연동.
 *
 * Common 이 닉네임의 source of truth. 응답의 nickname 을 그대로 채택할 것.
 * - id 우선 조회 → 없으면 email fallback → 없으면 신규 생성
 * - 신규 생성 시 req.nickname 은 base hint, 충돌 시 Common 이 base1, base2 ... 자동 부여
 *
 * 응답: { userId, nickname, coins, isOperator }
 */
async function ensureCommonUser({ id, email, nickname }) {
  try {
    const res = await fetch(`${COMMON_API}/api/users/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email, nickname }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 코인 지급
 */
async function earnCoins(commonUserId, amount, reason, appId = 'platform') {
  if (!commonUserId || amount <= 0) return;
  try {
    await fetch(`${COMMON_API}/api/coins/earn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: commonUserId, amount, reason, appId }),
    });
  } catch {}
}

/**
 * 코인 사용
 */
async function spendCoins(commonUserId, amount, reason, appId = 'platform') {
  if (!commonUserId || amount <= 0) return false;
  try {
    const res = await fetch(`${COMMON_API}/api/coins/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: commonUserId, amount, reason, appId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { ensureCommonUser, earnCoins, spendCoins };
