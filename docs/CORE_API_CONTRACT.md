# Core API Contract (Auth / Characters / Worlds)

Last updated: 2026-05-26

This document is the single source of truth for the frontend/backend contract used by:
- login / signup
- character creation & selection
- world list / world enter

Base URL:
- Production API: `https://airliveplay.com/api`
- Local API: `http://localhost:3000/api`

---

## 1) Auth

### `POST /api/auth/signup`
Request
```json
{
  "email": "user@example.com",
  "nickname": "player1",
  "password": "password1234",
  "redirectTo": "https://airliveplay.com/ko/login"
}
```

Success (201)
```json
{
  "message": "..."
}
```
(`message` text may vary by auth provider state)

Error
```json
{
  "error": {
    "message": "..."
  }
}
```

### `POST /api/auth/login`
Request
```json
{
  "email": "user@example.com",
  "password": "password1234"
}
```

Success (200)
```json
{
  "session": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1716700000
  },
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "player1"
  }
}
```

Error
```json
{
  "error": {
    "message": "..."
  }
}
```

### `POST /api/auth/exchange` (Bearer required)
Headers
```
Authorization: Bearer <token>
```

Success
```json
{
  "token": "..."
}
```
or fallback
```json
{
  "token": "...",
  "fallback": true
}
```

### `GET /api/auth/me` (Bearer required)
Success
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "nickname": "player1",
    "coins": 0,
    "createdAt": "2026-05-26T00:00:00.000Z",
    "isOperator": false,
    "operatorAccess": false,
    "isSubscribed": false,
    "subscriptionUntil": null
  }
}
```

### `GET /api/me` (Bearer required, lightweight profile)
Success
```json
{
  "id": "uuid",
  "nickname": "player1",
  "name": "player1"
}
```

---

## 2) Characters

### `GET /api/characters` (Bearer required)
Success
```json
{
  "characters": [
    {
      "id": "char_id",
      "userId": "uuid",
      "name": "My Character",
      "appearance": {},
      "isActive": true,
      "isPublic": false,
      "shareSlug": null
    }
  ],
  "activeCharacter": {
    "id": "char_id",
    "name": "My Character"
  }
}
```

### `GET /api/characters/me` (Bearer required)
Success
```json
{
  "character": {
    "id": "char_id",
    "name": "My Character",
    "appearance": {},
    "isActive": true
  }
}
```

### `POST /api/characters` (Bearer required)
Request
```json
{
  "name": "My Character",
  "appearance": {}
}
```

Success
```json
{
  "character": {
    "id": "char_id",
    "name": "My Character",
    "appearance": {},
    "isActive": true
  }
}
```

### `POST /api/characters/:id/select` (Bearer required)
Success
```json
{
  "character": {
    "id": "char_id",
    "isActive": true
  }
}
```

### `PATCH /api/characters/:id` (Bearer required)
Request
```json
{
  "name": "New Name",
  "appearance": {}
}
```

Success
```json
{
  "character": {
    "id": "char_id",
    "name": "New Name"
  }
}
```

### `DELETE /api/characters/:id` (Bearer required)
Success
```json
{
  "ok": true
}
```

---

## 3) Worlds

### `GET /api/worlds/public`
Success
```json
{
  "worlds": [
    {
      "id": "world_id",
      "name": "World 1",
      "description": "...",
      "thumbnailUrl": null,
      "playCount": 0,
      "creator": {
        "username": "owner"
      }
    }
  ]
}
```

### `GET /api/worlds/my` (Bearer required)
Success
```json
{
  "worlds": [
    {
      "id": "world_id",
      "name": "My World",
      "mapData": {
        "objects": []
      }
    }
  ]
}
```

### `GET /api/worlds/:id`
Success
```json
{
  "world": {
    "id": "world_id",
    "name": "My World",
    "isPublic": true,
    "mapData": {
      "objects": []
    },
    "creator": {
      "username": "owner"
    }
  }
}
```

### `POST /api/worlds` (Bearer required)
Request
```json
{
  "name": "My World",
  "description": "desc",
  "mapData": {
    "objects": []
  }
}
```

Success
```json
{
  "world": {
    "id": "world_id",
    "name": "My World"
  }
}
```

### `PATCH /api/worlds/:id` (Bearer required)
Request
```json
{
  "name": "My World v2",
  "description": "desc",
  "mapData": {
    "objects": []
  },
  "isPublic": true,
  "thumbnailUrl": "https://..."
}
```

Success
```json
{
  "world": {
    "id": "world_id",
    "name": "My World v2"
  }
}
```

### `DELETE /api/worlds/:id` (Bearer required)
Success
```json
{
  "ok": true
}
```

---

## 4) Error shape (required)

All error responses must follow:
```json
{
  "error": {
    "message": "Human-readable reason"
  }
}
```

---

## 5) Regression checklist (manual)

1. Signup works (or returns clear validation error).
2. Login returns `session.access_token`.
3. Exchange returns platform token (or fallback token with `fallback: true`).
4. `/api/me` and `/api/auth/me` both return 200 with valid token.
5. Character create/select/delete works.
6. World create/save/load works.

