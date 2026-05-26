'use strict';

const { Router }   = require('express');
const { requireAuth } = require('../middleware/auth');
const r2           = require('../lib/r2');
const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const https        = require('https');
const http         = require('http');

const router = Router();

const BLENDER_BIN   = process.env.BLENDER_BIN || 'blender';
const RIG_SCRIPT    = path.join(__dirname, '../../scripts/rig_character.py');

const REQUIRED_MARKERS = ['chin','leftWrist','rightWrist','leftElbow','rightElbow','leftKnee','rightKnee','groin'];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file   = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

router.post('/', requireAuth, async (req, res, next) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-rig-'));
  try {
    const { meshUrl, markers } = req.body || {};

    // 유효성 검사
    if (!meshUrl) return res.status(400).json({ error: { message: 'meshUrl required' } });
    const missing = REQUIRED_MARKERS.filter(k => !markers?.[k] || markers[k].length !== 3);
    if (missing.length) {
      return res.status(400).json({ error: { message: `Missing markers: ${missing.join(', ')}` } });
    }

    // 1. 메시 다운로드
    const inputPath  = path.join(tmp, 'input.fbx');
    const outputPath = path.join(tmp, 'output.fbx');
    await download(meshUrl, inputPath);

    // 2. Blender 리깅
    const markersArg = JSON.stringify(markers).replace(/'/g, "'\\''");
    const cmd = `${BLENDER_BIN} --background --python "${RIG_SCRIPT}" -- "${inputPath}" "${outputPath}" '${markersArg}'`;
    execSync(cmd, { timeout: 120_000, stdio: 'pipe' });

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: { message: 'Rigging failed — output not generated' } });
    }

    // 3. R2 업로드
    const id    = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const r2Key = `assets/${req.user.id}/rigged_${id}.fbx`;
    await r2.putObject(r2Key, fs.readFileSync(outputPath), { contentType: 'application/octet-stream' });

    res.json({ ok: true, modelUrl: `https://play.airliveplay.com/${r2Key}` });
  } catch (err) {
    next(err);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

module.exports = router;
