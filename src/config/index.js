require('dotenv').config();

const required = ['DATABASE_URL'];
// JWT_SECRET (자체 발급) 또는 SUPABASE_JWT_SECRET (Supabase) 중 하나 필요
if (!process.env.JWT_SECRET && !process.env.SUPABASE_JWT_SECRET) {
  console.error('Missing required env: JWT_SECRET or SUPABASE_JWT_SECRET');
  process.exit(1);
}
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  corsOrigin: (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim()),
  jwt: {
    // SUPABASE_JWT_SECRET 이 있으면 Supabase 발급 JWT 검증, 없으면 자체 JWT
    secret: process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  supabase: {
    jwtSecret: process.env.SUPABASE_JWT_SECRET || null,
  },
};
