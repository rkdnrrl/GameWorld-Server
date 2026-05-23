const { Router } = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();
const operatorRouter = Router();

const categorySchema = z.object({
  slug:      z.string().min(1).max(30).regex(/^[a-z0-9_-]+$/, 'slug는 소문자·숫자·-·_ 만 허용'),
  labelKo:   z.string().min(1).max(50),
  labelEn:   z.string().min(1).max(50),
  emoji:     z.string().max(10).optional(),
  sortOrder: z.number().int().optional(),
});

const patchSchema = z.object({
  labelKo:   z.string().min(1).max(50).optional(),
  labelEn:   z.string().min(1).max(50).optional(),
  emoji:     z.string().max(10).optional(),
  sortOrder: z.number().int().optional(),
});

/** GET /api/categories — 공개 */
router.get('/', async (req, res, next) => {
  try {
    const cats = await prisma.gameCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ categories: cats });
  } catch (err) { next(err); }
});

/** POST /api/operator/categories — 카테고리 추가 */
operatorRouter.post('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const data = categorySchema.parse(req.body);
    const cat = await prisma.gameCategory.create({ data: {
      slug: data.slug, labelKo: data.labelKo, labelEn: data.labelEn,
      emoji: data.emoji ?? '🎮', sortOrder: data.sortOrder ?? 0,
    }});
    res.json({ ok: true, category: cat });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 오류' } });
    if (err.code === 'P2002') return res.status(409).json({ error: { message: '이미 존재하는 slug입니다.' } });
    next(err);
  }
});

/** PATCH /api/operator/categories/:slug — 카테고리 수정 */
operatorRouter.patch('/:slug', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const data = patchSchema.parse(req.body);
    const cat = await prisma.gameCategory.update({ where: { slug }, data });
    res.json({ ok: true, category: cat });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 오류' } });
    if (err.code === 'P2025') return res.status(404).json({ error: { message: '카테고리를 찾을 수 없습니다.' } });
    next(err);
  }
});

/** DELETE /api/operator/categories/:slug — 카테고리 삭제 */
operatorRouter.delete('/:slug', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = req.params.slug;
    // 해당 카테고리를 사용 중인 게임 수 확인
    const count = await prisma.game.count({ where: { category: slug } });
    if (count > 0) {
      return res.status(409).json({ error: { message: `${count}개 게임이 이 카테고리를 사용 중입니다. 게임의 카테고리를 먼저 변경해주세요.` } });
    }
    await prisma.gameCategory.delete({ where: { slug } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: { message: '카테고리를 찾을 수 없습니다.' } });
    next(err);
  }
});

module.exports = { router, operatorRouter };
