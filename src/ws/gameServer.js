/**
 * ALP World - WebSocket 게임 서버
 * 실시간 플레이어 위치 동기화 (월드별 분리)
 *
 * 프로토콜:
 *  C→S: { type:'join', worldId, playerId, username, character }
 *  C→S: { type:'move', x, y, z, rotY }
 *  C→S: { type:'chat', message }
 *  C→S: { type:'script_event', objectId, event, data }
 *  C→S: { type:'object_states', states:[{id,pos,rot,scl,vis,anim?,grabbedBy?}] }
 *  C→S: { type:'obj_claim', objectId }
 *  C→S: { type:'obj_release', objectId }
 *
 *  S→C: { type:'players', players:[{id,username,character,x,y,z,rotY}] }
 *  S→C: { type:'joined', id, username, character, x, y, z, rotY }
 *  S→C: { type:'moved',  id, x, y, z, rotY }
 *  S→C: { type:'left',   id }
 *  S→C: { type:'chat',   id, username, message }
 *  S→C: { type:'script_event', objectId, event, data, fromId }
 *  S→C: { type:'object_states', states:[...], fromId }
 *  S→C: { type:'obj_owner', objectId, ownerId }            — owner change broadcast
 *  S→C: { type:'obj_owner_snapshot', owners:[{objectId,ownerId}] }  — on join
 */

// worlds: worldId → Map(playerId → { ws, id, username, character, x, y, z, rotY })
const worlds = new Map();
// 오브젝트 소유권 — worldId → Map(objectId → ownerPlayerId)
// obj_claim 으로 set, obj_release 또는 owner disconnect 시 clear.
// 신규 join 시 전체 상태를 'obj_owner_snapshot' 으로 전송.
const worldOwners = new Map();

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

        // 현재 오브젝트 소유권 상태 전송 — 신규 join 시 멀티 동기화용
        const owners = worldOwners.get(worldId);
        if (owners && owners.size > 0) {
          const entries = [...owners.entries()].map(([objectId, ownerId]) => ({ objectId, ownerId }));
          send(ws, { type: 'obj_owner_snapshot', owners: entries });
        }

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

      else if (msg.type === 'object_states') {
        // Authority 클라이언트가 broadcast하는 dynamic/scripted 오브젝트 상태
        if (!worldId || !playerId) return;
        if (!Array.isArray(msg.states)) return;
        broadcast(worldId, playerId, {
          type: 'object_states',
          states: msg.states,
          fromId: playerId,
        });
      }

      else if (msg.type === 'obj_claim') {
        // 오브젝트 소유권 주장 — 충돌/grab 시. 본인이 권위자가 됨.
        if (!worldId || !playerId) return;
        const objectId = String(msg.objectId || '').slice(0, 80);
        if (!objectId) return;
        if (!worldOwners.has(worldId)) worldOwners.set(worldId, new Map());
        worldOwners.get(worldId).set(objectId, playerId);
        // 전체에 broadcast (claimer 본인도 포함 — 멱등)
        broadcastAll(worldId, { type: 'obj_owner', objectId, ownerId: playerId });
      }

      else if (msg.type === 'obj_release') {
        // 오브젝트 소유권 해제 — 본인이 owner 일 때만 의미. 호스트 fallback 으로 돌아감.
        if (!worldId || !playerId) return;
        const objectId = String(msg.objectId || '').slice(0, 80);
        if (!objectId) return;
        const owners = worldOwners.get(worldId);
        // 본인 owner 일 때만 release 허용 (race condition 방지 — 다른 사람이 이미 가져갔으면 무시)
        if (owners && owners.get(objectId) === playerId) {
          owners.delete(objectId);
          broadcastAll(worldId, { type: 'obj_owner', objectId, ownerId: null });
        }
      }

      else if (msg.type === 'script_event') {
        // Lua net:sendAll() / net:sendTo() 릴레이
        if (!worldId || !playerId) return;
        const objectId = String(msg.objectId || '').slice(0, 80);
        const event    = String(msg.event    || '').slice(0, 80);
        const toId     = msg.toId ? String(msg.toId).slice(0, 40) : null;
        if (!objectId || !event) return;

        const payload = { type: 'script_event', objectId, event, data: msg.data ?? {}, fromId: playerId };

        if (toId) {
          // sendTo: 특정 플레이어에게만
          const room = worlds.get(worldId);
          const target = room?.get(toId);
          if (target) send(target.ws, payload);
        } else {
          // sendAll: 자신 포함 전체 브로드캐스트
          broadcastAll(worldId, payload);
        }
      }
    });

    ws.on('close', () => {
      if (!worldId || !playerId) return;
      const room = worlds.get(worldId);
      if (!room) return;

      const player = room.get(playerId);
      room.delete(playerId);

      // disconnect 한 플레이어가 소유했던 오브젝트 전부 해제 — 다른 클라가 호스트 fallback 으로 이어받음
      const owners = worldOwners.get(worldId);
      if (owners) {
        for (const [objectId, ownerId] of owners) {
          if (ownerId === playerId) {
            owners.delete(objectId);
            broadcast(worldId, playerId, { type: 'obj_owner', objectId, ownerId: null });
          }
        }
        if (owners.size === 0) worldOwners.delete(worldId);
      }

      if (room.size === 0) {
        worlds.delete(worldId);
        worldOwners.delete(worldId);
      }

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
