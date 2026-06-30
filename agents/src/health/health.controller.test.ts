import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { AppConfigService } from '../config/app-config.service.js';
import type { RedisService } from '../store/redis.service.js';

function createConfig(): AppConfigService {
  return {
    goldbot: {
      apiUrl: 'http://goldbot.local',
      apiToken: 'token',
    },
  } as AppConfigService;
}

describe('HealthController', () => {
  it('returns ok when Redis and Goldbot are reachable', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response);
    const redis = { ping: vi.fn().mockResolvedValue('PONG') } as unknown as RedisService;
    const controller = new HealthController(redis, createConfig(), 1000);

    const result = await controller.getHealth();

    expect(result.status).toBe('ok');
    expect(result.redis).toBe(true);
    expect(result.goldbot).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://goldbot.local/health',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
      }),
    );

    fetchMock.mockRestore();
  });

  it('throws 503 degraded response when Redis is unavailable', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response);
    const redis = { ping: vi.fn().mockRejectedValue(new Error('down')) } as unknown as RedisService;
    const controller = new HealthController(redis, createConfig(), 1000);

    await expect(controller.getHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchMock.mockRestore();
  });
});
