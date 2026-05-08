const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = { prisma, disconnect };
