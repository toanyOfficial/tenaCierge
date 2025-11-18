import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';

const globalForDb = globalThis as unknown as {
  mysqlPool?: mysql.Pool;
};

export function getPool() {
  if (!globalForDb.mysqlPool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL 환경변수가 필요합니다.');
    }

    globalForDb.mysqlPool = mysql.createPool(connectionString);
  }

  return globalForDb.mysqlPool;
}

export const db = drizzle(getPool());
