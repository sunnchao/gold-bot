import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { bootstrapTokens } from './tokens.js';

describe('bootstrapTokens', () => {
  it('seeds admin token from environment variable', async () => {
    const store = createInMemoryEaStore();
    const result = await bootstrapTokens(store, 'test-admin-token-123');

    expect(result.adminTokensSeeded).toBe(1);
    expect(result.legacyTokensImported).toBe(0);

    const tokens = await store.listApiTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).toBe('test-admin-token-123');
    expect(tokens[0].is_admin).toBe(true);
    expect(tokens[0].name).toBe('env-admin');
  });

  it('skips seeding if admin token already exists', async () => {
    const store = createInMemoryEaStore();
    await store.saveApiToken({
      token: 'existing-admin',
      name: 'manual',
      is_admin: true,
      accounts: []
    });

    const result = await bootstrapTokens(store, 'existing-admin');

    expect(result.adminTokensSeeded).toBe(0);
    expect(await store.listApiTokens()).toHaveLength(1);
  });

  it('imports legacy tokens from JSON file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'token-bootstrap-'));
    const tokensPath = join(tmpDir, 'tokens.json');

    try {
      writeFileSync(
        tokensPath,
        JSON.stringify([
          { token: 'legacy-token-1', name: 'user1', is_admin: false, accounts: ['90011087'] },
          { token: 'legacy-token-2', name: 'user2', is_admin: true, accounts: [] }
        ])
      );

      const store = createInMemoryEaStore();
      const result = await bootstrapTokens(store, '', tokensPath);

      expect(result.adminTokensSeeded).toBe(0);
      expect(result.legacyTokensImported).toBe(2);

      const tokens = await store.listApiTokens();
      expect(tokens).toHaveLength(2);
      expect(tokens[0].token).toBe('legacy-token-1');
      expect(tokens[0].is_admin).toBe(false);
      expect(tokens[1].token).toBe('legacy-token-2');
      expect(tokens[1].is_admin).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('skips legacy tokens that already exist', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'token-bootstrap-'));
    const tokensPath = join(tmpDir, 'tokens.json');

    try {
      writeFileSync(
        tokensPath,
        JSON.stringify([
          { token: 'existing-token', name: 'user1', is_admin: false, accounts: [] },
          { token: 'new-token', name: 'user2', is_admin: false, accounts: [] }
        ])
      );

      const store = createInMemoryEaStore();
      await store.saveApiToken({
        token: 'existing-token',
        name: 'manual',
        is_admin: false,
        accounts: []
      });

      const result = await bootstrapTokens(store, '', tokensPath);

      expect(result.legacyTokensImported).toBe(1);
      expect(await store.listApiTokens()).toHaveLength(2);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('handles missing legacy tokens file gracefully', async () => {
    const store = createInMemoryEaStore();
    const result = await bootstrapTokens(store, '', '/nonexistent/tokens.json');

    expect(result.adminTokensSeeded).toBe(0);
    expect(result.legacyTokensImported).toBe(0);
  });

  it('combines admin token seed and legacy import', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'token-bootstrap-'));
    const tokensPath = join(tmpDir, 'tokens.json');

    try {
      writeFileSync(
        tokensPath,
        JSON.stringify([{ token: 'legacy-token', name: 'user1', is_admin: false, accounts: [] }])
      );

      const store = createInMemoryEaStore();
      const result = await bootstrapTokens(store, 'admin-token', tokensPath);

      expect(result.adminTokensSeeded).toBe(1);
      expect(result.legacyTokensImported).toBe(1);
      expect(await store.listApiTokens()).toHaveLength(2);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
