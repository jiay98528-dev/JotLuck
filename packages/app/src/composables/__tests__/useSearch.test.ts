import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '../useSearch';

describe('parseSearchQuery', () => {
  it('recognizes one regex literal between filters and preserves outside text', () => {
    const query = parseSearchQuery('alpha tag:入门 /欢迎\\s+使用/im folder:docs beta');

    expect(query).toMatchObject({
      text: 'alpha beta',
      regex: '欢迎\\s+使用',
      regexFlags: 'im',
      tags: ['入门'],
      folder: 'docs',
    });
  });

  it('allows spaces and escaped slashes inside the regex literal', () => {
    const query = parseSearchQuery(String.raw`tag:web /assets\/hero image\.png/g`);

    expect(query.text).toBe('');
    expect(query.regex).toBe(String.raw`assets\/hero image\.png`);
    expect(query.regexFlags).toBe('g');
    expect(query.tags).toEqual(['web']);
  });

  it('uses case-insensitive matching when the literal has no flags', () => {
    expect(parseSearchQuery('/Welcome/')).toMatchObject({
      text: '',
      regex: 'Welcome',
      regexFlags: 'i',
    });
  });

  it('keeps an unclosed slash expression as ordinary text', () => {
    expect(parseSearchQuery('tag:入门 /欢迎 使用')).toMatchObject({
      text: '/欢迎 使用',
      tags: ['入门'],
    });
    expect(parseSearchQuery('tag:入门 /欢迎 使用')).not.toHaveProperty('regex');
  });
});
