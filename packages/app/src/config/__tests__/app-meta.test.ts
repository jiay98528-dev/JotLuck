import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_ISSUES_URL,
  APP_LICENSE_URL,
  APP_RELEASES_API_URL,
  APP_RELEASES_URL,
  APP_REPOSITORY_URL,
  APP_VERSION,
} from '../app-meta';

describe('app-meta', () => {
  it('uses the package version as the app version', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };

    expect(APP_VERSION).toBe(packageJson.version);
  });

  it('derives public links from a single repository URL', () => {
    expect(APP_ISSUES_URL).toBe(`${APP_REPOSITORY_URL}/issues`);
    expect(APP_LICENSE_URL).toBe(`${APP_REPOSITORY_URL}/blob/main/LICENSE`);
    expect(APP_RELEASES_URL).toBe(`${APP_REPOSITORY_URL}/releases`);
    expect(APP_RELEASES_API_URL).toContain('/releases/latest');
  });
});
