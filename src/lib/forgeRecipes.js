/**
 * Singleplay-Game5 `recipes.js` 와 동일 — 서버에서 레시피·이름 검증용
 */
'use strict';

const RECIPES = [
  { id: 'void-blade', need: ['블랙홀', '암흑물질', '결정'], out: { name: '보이드 날', emoji: '🗡️', tier: 'legendary', desc: '빛까지 삼키는 단검' } },
  { id: 'omega-ring', need: ['오메가', '다크매터', '샤드'], out: { name: '오메가 암흑 반지', emoji: '💍', tier: 'legendary', desc: '손가락에 중력장' } },
  { id: 'quantum-helm', need: ['양자', '중성자', '코어'], out: { name: '양자 중성자 투구', emoji: '🪖', tier: 'epic', desc: '머리 주변 확률이 흔들림' } },
  { id: 'pulsar-bow', need: ['펄사', '광자', '프리즘'], out: { name: '펄사 광시공활', emoji: '🏹', tier: 'epic', desc: '쏘면 별이 잠깐 반짝' } },
  { id: 'nebula-mail', need: ['네뷸라', '성운', '플라즈마'], out: { name: '성운 플라즈마 갑옷', emoji: '🛡️', tier: 'epic', desc: '몸에 은하가 돌아다님' } },
  { id: 'parallel-boots', need: ['평행우주', '다차원', '모듈'], out: { name: '차원 건너 샌들', emoji: '🥾', tier: 'epic', desc: '한 발은 다른 세계' } },
  { id: 'solar-crown', need: ['솔라', '은하'], out: { name: '솔라 은하 왕관', emoji: '👑', tier: 'epic', desc: '자외선 주의' } },
  { id: 'wormhole-hook', need: ['블랙홀', '성간'], out: { name: '성간 웜홀 갈고리', emoji: '🪝', tier: 'epic', desc: '낚시와 시너지' } },
  { id: 'hubble-gazer', need: ['허블', '성운'], out: { name: '허블 성운 렌즈', emoji: '🔭', tier: 'epic', desc: '먼 곳이 조금 덜 먼 곳' } },
  { id: 'relic-shield', need: ['유물', '석판', '고대'], out: { name: '고대 유물 방패', emoji: '🛡️', tier: 'rare', desc: '박물관에서 빌려옴' } },
  { id: 'circuit-gauntlet', need: ['회로', '인공물', '프로토타입'], out: { name: '프로토 회로 건틀릿', emoji: '🧤', tier: 'rare', desc: '악수하면 정전기' } },
  { id: 'artifact-amulet', need: ['파편', '모듈'], out: { name: '모듈 파편 아뮬렛', emoji: '📿', tier: 'rare', desc: '조립 설명서 없음' } },
  { id: 'war-engine', need: ['전쟁터', '엔진'], out: { name: '전쟁 엔진 어깨', emoji: '⚙️', tier: 'rare', desc: '과열 주의' } },
  { id: 'satellite-hammer', need: ['위성', '궤도', '드론'], out: { name: '궤도 해머', emoji: '🔨', tier: 'rare', desc: '위성도 두드림' } },
  { id: 'plasma-torch', need: ['플라즈마', '이온'], out: { name: '이온 플라즈마 횃불', emoji: '🔥', tier: 'rare', desc: '바비큐 금지 구역' } },
  { id: 'crystal-lance', need: ['결정', '클러스터'], out: { name: '클러스터 창', emoji: '🔱', tier: 'rare', desc: '반짝이는 찌르기' } },
  { id: 'coral-visor', need: ['상어', '결정'], out: { name: '삼차원 상어 바이저', emoji: '🥽', tier: 'rare', desc: '시야가 톱니 모양' } },
  { id: 'kraken-grip', need: ['포식자', '문어'], out: { name: '크라켄 손잡이', emoji: '🦑', tier: 'rare', desc: '놓치지 않음' } },
  { id: 'alien-badge', need: ['외계', '유물'], out: { name: '외계 방문자 배지', emoji: '🛸', tier: 'rare', desc: '세관 통과 불가' } },
  { id: 'shark-tooth-dagger', need: ['상어', '피라냐'], out: { name: '톱니 쌍날 단검', emoji: '🔪', tier: 'rare', desc: '물고기들이 화해함' } },
  { id: 'meteor-skates', need: ['우주', '잔해'], out: { name: '궤도 잔해 스케이트', emoji: '🛼', tier: 'common', desc: '미끄러움 주의' } },
  { id: 'pulse-skates', need: ['우주', '펄사'], out: { name: '펄사 추진 스케이트', emoji: '🛼', tier: 'rare', desc: '리듬에 맞춰 가속' } },
  { id: 'fridge-axe', need: ['냉장고', '코어'], out: { name: '코어 냉각 도끼', emoji: '🧊', tier: 'rare', desc: '냉장고에서 영감' } },
  { id: 'jelly-cloak', need: ['해파리', '플랑크톤'], out: { name: '말랑 해파리 망토', emoji: '🧥', tier: 'common', desc: '추워도 말랑' } },
  { id: 'octopus-belt', need: ['문어', '오징어'], out: { name: '촉수 허리띠', emoji: '〰️', tier: 'common', desc: '다용도 홀더' } },
  { id: 'debris-knuckles', need: ['잔해', '쓰레기', '패널'], out: { name: '우주 잔해 너클', emoji: '✊', tier: 'common', desc: '재활용의 극의' } },
  { id: 'whale-horn', need: ['돌고래', '청어'], out: { name: '돌고래 청어 나팔', emoji: '📯', tier: 'common', desc: '바다 느낌 스택' } },
  { id: 'mackerel-sword', need: ['고등어', '청어'], out: { name: '은빛 청어검', emoji: '⚔️', tier: 'common', desc: '회 뜨기 불가' } },
  { id: 'plankton-charm', need: ['플랑크톤', '포자'], out: { name: '포자 플랑크톤 부적', emoji: '🔰', tier: 'common', desc: '작지만 많음' } },
  { id: 'rust-pickaxe', need: ['녹슨', '컨테이너'], out: { name: '녹슨 궤도 곡괭이', emoji: '⛏️', tier: 'common', desc: '이미 녹슴' } },
  { id: 'abandoned-box', need: ['버려진', '컨테이너'], out: { name: '버려진 보급 상자', emoji: '📦', tier: 'common', desc: '열기 전에 흔들기' } },
  { id: 'nebula-fish', need: ['네뷸라', '멸치'], out: { name: '성운 멸치 지팡이', emoji: '🪄', tier: 'rare', desc: '작은 빛의 무리' } },
  { id: 'crystal-squid', need: ['결정', '오징어'], out: { name: '결정 오징어 창', emoji: '🔱', tier: 'rare', desc: '쫄깃하고 단단' } },
];

module.exports = { RECIPES };
