import { beforeEach, describe, expect, it } from 'vitest';
import { createMockThemeCommerceProvider } from '@/services/ThemeCommerceProvider';
import type { InstalledThemePack } from '@/types/theme-pack';

function pack(overrides: Partial<InstalledThemePack['manifest']> = {}): InstalledThemePack {
  return {
    manifest: {
      id: 'local.commerce-theme',
      version: '1.0.0',
      themeApi: 2,
      runtime: 'trusted-code',
      minAppVersion: '0.15.0',
      name: 'Commerce Theme',
      author: 'Tester',
      capabilities: ['tokens', 'ux-components'],
      permissions: ['shell-layout', 'network', 'filesystem-write'],
      layoutPreset: 'atelier',
      checksums: {},
      sku: 'commerce-theme',
      price: '$9',
      licenseKind: 'paid',
      purchaseUrl: 'https://example.invalid/checkout',
      ...overrides,
    },
    css: '',
    source: 'market',
    installedAt: 0,
  };
}

describe('ThemeCommerceProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes real backend endpoints while using local mock state', async () => {
    const provider = createMockThemeCommerceProvider(() => [pack()]);

    expect(provider.catalogEndpoint).toBe('/v1/themes/catalog');
    expect(provider.checkoutEndpoint).toBe('/v1/themes/checkout');

    const catalog = await provider.getCatalog();

    expect(catalog[0]?.manifest.id).toBe('local.commerce-theme');
    expect(catalog[0]?.entitlement.state).toBe('purchase-required');
  });

  it('creates mock checkout and redeems local entitlements', async () => {
    const provider = createMockThemeCommerceProvider(() => [pack()]);

    const checkout = await provider.createCheckout({
      themeId: 'local.commerce-theme',
      sku: 'commerce-theme',
    });

    expect(checkout.state).toBe('local-mock');
    expect(checkout.checkoutUrl).toBe('https://example.invalid/checkout');

    const entitlements = await provider.redeemLicense({
      themeId: 'local.commerce-theme',
      licenseKey: 'ML-TEST',
    });

    expect(entitlements['local.commerce-theme']?.state).toBe('owned');
    expect(entitlements['local.commerce-theme']?.licenseKey).toBe('ML-TEST');
  });
});
