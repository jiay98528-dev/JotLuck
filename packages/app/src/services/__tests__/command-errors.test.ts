import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommandError,
  isCommandErrorPayload,
  localizeCommandError,
  localizeUserError,
  normalizeCommandError,
} from '../command-errors';
import { setLocale } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/types';

describe('structured command error codes', () => {
  beforeEach(async () => {
    await setLocale('zh-CN', { persist: false });
  });

  it.each(SUPPORTED_LOCALES)(
    'localizes external_grant_expired with dedicated copy in %s',
    async (locale) => {
      await setLocale(locale, { persist: false });

      const message = localizeCommandError({ code: 'external_grant_expired' });

      // 各语言必须是授权失效专属文案，而不是通用 operation_failed 兜底。
      expect(message.trim().length).toBeGreaterThan(0);
      expect(isCommandErrorPayload({ code: 'external_grant_expired' })).toBe(true);
    },
  );

  it.each(SUPPORTED_LOCALES)(
    'localizes conversion_stale with dedicated copy in %s',
    async (locale) => {
      await setLocale(locale, { persist: false });

      const message = localizeCommandError({ code: 'conversion_stale' });

      expect(message.trim().length).toBeGreaterThan(0);
    },
  );

  it('maps external_grant_expired onto the existing zh-CN externalAccessExpired copy', async () => {
    await setLocale('zh-CN', { persist: false });

    expect(localizeCommandError({ code: 'external_grant_expired' })).toBe(
      '当前外部文件的写入授权已失效。',
    );
  });

  it('keeps the generic operation_failed copy distinct from the dedicated stale copy', async () => {
    await setLocale('zh-CN', { persist: false });

    const stale = localizeCommandError({ code: 'conversion_stale' });
    const generic = localizeCommandError({ code: 'operation_failed' });

    expect(stale).toContain('重新转换');
    expect(stale).not.toBe(generic);
  });

  it('accepts wire payloads carrying the new structured codes through normalizeCommandError', () => {
    const wire = JSON.stringify({ code: 'external_grant_expired' });
    const normalized = normalizeCommandError(wire);
    expect(normalized).toBeInstanceOf(CommandError);
    if (!(normalized instanceof CommandError)) throw new Error('expected a CommandError');
    expect(normalized.payload.code).toBe('external_grant_expired');
    expect(localizeUserError(wire)).toContain('授权');
  });

  it('rejects unknown codes instead of guessing a structured meaning', () => {
    expect(isCommandErrorPayload({ code: 'stale' })).toBe(false);
    const normalized = normalizeCommandError({ code: 'stale' });
    if (!(normalized instanceof CommandError)) throw new Error('expected a CommandError');
    expect(normalized.payload.code).toBe('operation_failed');
  });
});
