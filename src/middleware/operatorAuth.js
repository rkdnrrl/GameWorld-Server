'use strict';

/**
 * 운영자: DB `users.isOperator === true` 이거나
 * 환경변수 `OPERATOR_EMAILS`에 쉼표/세미콜론/공백으로 구분된 이메일(대소문자 무시)이 포함된 경우.
 */
function parseOperatorEmailsFromEnv() {
  return String(process.env.OPERATOR_EMAILS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function userIsOperator(user) {
  if (!user) return false;
  if (user.isOperator === true) return true;
  if (user.email) {
    const emails = parseOperatorEmailsFromEnv();
    return emails.includes(String(user.email).toLowerCase().trim());
  }
  return false;
}

function requireOperator(req, res, next) {
  if (!userIsOperator(req.user)) {
    return res.status(403).json({ error: { message: '운영자만 접근할 수 있습니다.' } });
  }
  next();
}

module.exports = { requireOperator, userIsOperator, parseOperatorEmailsFromEnv };
