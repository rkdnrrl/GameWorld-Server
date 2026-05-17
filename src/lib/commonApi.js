const COMMON_API = 'https://api.airliveplay.com';

/**
 * 공통 API 유저 연동 — 이메일로 commonUserId 발급
 */
// { userId, isOperator, coins } 반환
async function ensureCommonUser(email, nickname) {
  try {
    const res = await fetch(`${COMMON_API}/api/users/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, nickname }),
    });
    if (!res.ok) return null;
    return await res.json(); // { userId, isOperator, coins, ... }
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
