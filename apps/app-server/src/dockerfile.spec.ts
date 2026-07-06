import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('app-server Docker image contract', () => {
  it('builds and ships the static dashboard for root route fallback', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('COPY apps/app-web/package.json');
    expect(dockerfile).toContain('COPY apps/app-web/app ./apps/app-web/app');
    expect(dockerfile).toContain('pnpm --filter app-web build');
    expect(dockerfile).toContain('/workspace/apps/app-web/dist');
  });
});
