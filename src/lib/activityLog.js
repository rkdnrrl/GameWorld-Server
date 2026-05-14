'use strict';

const { prisma } = require('../db');

/**
 * 활동 로그를 fire-and-forget으로 기록합니다.
 * 실패해도 요청에 영향 없음.
 * @param {{ id: string, nickname: string }} user
 * @param {'fish_catch'|'smelt_melt'|'forge_craft'} action
 * @param {object} detail
 */
function logActivity(user, action, detail) {
  prisma.activityLog
    .create({
      data: {
        userId: user.id,
        nickname: user.nickname,
        action,
        detail: detail ?? {},
      },
    })
    .catch((err) => console.warn('[activityLog] 로그 기록 실패:', err?.message));
}

module.exports = { logActivity };
