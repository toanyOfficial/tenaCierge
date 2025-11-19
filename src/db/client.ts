import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';

const globalForDb = globalThis as unknown as {
  mysqlPool?: mysql.Pool;
};

export function getPool() {
  if (!globalForDb.mysqlPool) {
    globalForDb.mysqlPool = createPoolFromEnv();
  }

  return globalForDb.mysqlPool;
}

export const db = drizzle(getPool());

function createPoolFromEnv() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return mysql.createPool(connectionString);
  }

  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

  if (!host || !user || !database) {
    throw new Error(
      'DB 연결정보가 없습니다. DATABASE_URL 또는 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME 환경변수를 설정해 주세요.'
    );
  }

  return mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
  });
}
