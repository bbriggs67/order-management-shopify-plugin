import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:AbbuLJtQBzmhhlcguykZIzTnItcPVACv@caboose.proxy.rlwy.net:28296/railway'
    }
  }
});

async function main() {
  try {
    console.log('Resetting database schema...');

    // Drop and recreate public schema (this removes all tables)
    await prisma.$executeRaw`DROP SCHEMA public CASCADE`;
    console.log('Dropped public schema');

    await prisma.$executeRaw`CREATE SCHEMA public`;
    console.log('Created public schema');

    await prisma.$executeRaw`GRANT ALL ON SCHEMA public TO postgres`;
    await prisma.$executeRaw`GRANT ALL ON SCHEMA public TO public`;
    console.log('Granted permissions');

    console.log('Database reset complete! Now redeploy the app to run migrations.');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
