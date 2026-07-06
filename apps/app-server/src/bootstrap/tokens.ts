import { existsSync, readFileSync } from 'node:fs';
import type { EaStore } from '@gold-bot/persistence';

export type LegacyTokenRecord = {
  token: string;
  name?: string;
  is_admin?: boolean;
  accounts?: string[];
};

export type BootstrapResult = {
  adminTokensSeeded: number;
  legacyTokensImported: number;
};

export async function bootstrapTokens(
  store: EaStore,
  adminToken: string,
  legacyTokensPath?: string
): Promise<BootstrapResult> {
  let adminTokensSeeded = 0;
  let legacyTokensImported = 0;

  // Seed admin token from environment variable
  if (adminToken.length > 0) {
    const existing = (await store.listApiTokens()).find((t) => t.token === adminToken);
    if (!existing) {
      await store.saveApiToken({
        token: adminToken,
        name: 'env-admin',
        is_admin: true,
        accounts: []
      });
      adminTokensSeeded = 1;
      console.log(`✓ Seeded admin token from GB_ADMIN_TOKEN (${maskToken(adminToken)})`);
    }
  }

  // Import legacy tokens.json if provided
  if (legacyTokensPath && existsSync(legacyTokensPath)) {
    try {
      const content = readFileSync(legacyTokensPath, 'utf8');
      const legacy = JSON.parse(content) as LegacyTokenRecord[];

      for (const record of legacy) {
        const existing = (await store.listApiTokens()).find((t) => t.token === record.token);
        if (!existing) {
          await store.saveApiToken({
            token: record.token,
            name: record.name ?? '',
            is_admin: record.is_admin ?? false,
            accounts: record.accounts ?? []
          });
          legacyTokensImported++;
        }
      }

      if (legacyTokensImported > 0) {
        console.log(`✓ Imported ${legacyTokensImported} tokens from ${legacyTokensPath}`);
      }
    } catch (error) {
      console.error(`✗ Failed to import legacy tokens from ${legacyTokensPath}:`, error);
    }
  }

  return { adminTokensSeeded, legacyTokensImported };
}

function maskToken(token: string): string {
  if (token.length <= 8) {
    return '***';
  }
  return token.slice(0, 4) + '...' + token.slice(-4);
}
