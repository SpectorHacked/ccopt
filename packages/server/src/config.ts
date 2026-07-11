export interface Config {
  port: number;
  databaseUrl: string;
  dataDir: string;
  adminToken: string;
  publicBaseUrl: string;
}

export function loadConfig(): Config {
  const adminToken = process.env.EFFIGENT_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error('EFFIGENT_ADMIN_TOKEN must be set (used to create tenants/API keys).');
  }
  return {
    port: Number(process.env.PORT ?? 8787),
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://effigent:effigent@localhost:5433/effigent',
    dataDir: process.env.EFFIGENT_DATA_DIR ?? './data',
    adminToken,
    publicBaseUrl: process.env.EFFIGENT_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  };
}
