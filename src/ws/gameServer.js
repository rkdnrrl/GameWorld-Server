/**
 * ALP World - WebSocket 게임 서버
 * 실시간 플레이어 위치 동기화 (월드별 분리)
 *
 * 프로토콜:
 *  C→S: { type:'join', worldId, playerId, username, character }
 *  C→S: { type:'move', x, y, z, rotY }
 *  C→S: { type:'chat', message }
 *
 *  S→C: { type:'players', players:[{id,username,character,x,y,z,rotY}] }
 *  S→C: { type:'joined', id, username, character, x, y, z, rotY }
 *  S→C: { type:'moved',  id, x, y, z, rotY }
 *  S→C: { type:'left',   id }
 *  S→C: { type:'chat',   id, username, message }
 */

// worlds: worldId → Map(playerId → { ws, id, username, character, x, y, z, rotY })
const worlds = new Map();

function createGameServer(wss) {
  wss.on('connection', (ws) => {
    let worldId = null;
    let playerId = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'join') {
        worldId  = String(msg.worldId || 'default').slice(0, 60);
        playerId = String(msg.playerId || '').slice(0, 40);
        if (!playerId) return;

        const playerEntry = {
          ws,
          id:        playerId,
          username:  String(msg.username || '익명').slice(0, 30),
          character: msg.character || {},
          x: 0, y: 1, z: 0, rotY: 0,
        };

        if (!worlds.has(worldId)) worlds.set(worldId, new Map());
        const room = worlds.get(worldId);
        room.set(playerId, playerEntry);

        // 기존 플레이어 목록 전송
        const players = [...room.values()]
          .filter(p => p.id !== playerId)
          .map(({ ws: _, ...p }) => p);
        send(ws, { type: 'players', players });

        // 다른 플레이어에게 신규 입장 알림
        broadcast(worldId, playerId, {
          type: 'joined',
          id: playerId,
          username: playerEntry.username,
          character: playerEntry.character,
          x: 0, y: 1, z: 0, rotY: 0,
        });

        console.log(`[ws] ${playerEntry.username} joined world:${worldId} (${room.size} players)`);
      }

      else if (msg.type === 'move') {
        if (!worldId || !playerId) return;
        const player = worlds.get(worldId)?.get(playerId);
        if (!player) return;

        player.x    = +msg.x    || 0;
        player.y    = +msg.y    || 0;
        player.z    = +msg.z    || 0;
        player.rotY = +msg.rotY || 0;

        broadcast(worldId, playerId, {
          type: 'moved',
          id:   playerId,
          x: player.x, y: player.y, z: player.z, rotY: player.rotY,
        });
      }

      else if (msg.type === 'chat') {
        if (!worldId || !playerId) return;
        const player = worlds.get(worldId)?.get(playerId);
        if (!player) return;
        const message = String(msg.message || '').trim().slice(0, 200);
        if (!message) return;

        // 자신 포함 전체 브로드캐스트
        broadcastAll(worldId, {
          type: 'chat',
          id: playerId,
          username: player.username,
          message,
        });
      }
    });

    ws.on('close', () => {
      if (!worldId || !playerId) return;
      const room = worlds.get(worldId);
      if (!room) return;

      const player = room.get(playerId);
      room.delete(playerId);
      if (room.size === 0) worlds.delete(worldId);

      broadcast(worldId, playerId, { type: 'left', id: playerId });
      if (player) console.log(`[ws] ${player.username} left world:${worldId}`);
    });

    ws.on('error', () => {});
  });

  // 플레이어 수 로깅 (5분마다)
  setInterval(() => {
    let total = 0;
    for (const [wid, room] of worlds) {
      total += room.size;
      if (room.size > 0) console.log(`[ws] world:${wid} → ${room.size} players`);
    }
  }, 300_000);
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(worldId, excludeId, obj) {
  const room = worlds.get(worldId);
  if (!room) return;
  const json = JSON.stringify(obj);
  for (const [id, { ws }] of room) {
    if (id !== excludeId && ws.readyState === 1) ws.send(json);
  }
}

function broadcastAll(worldId, obj) {
  const room = worlds.get(worldId);
  if (!room) return;
  const json = JSON.stringify(obj);
  for (const { ws } of room.values()) {
    if (ws.readyState === 1) ws.send(json);
  }
}

module.exports = { createGameServer };
