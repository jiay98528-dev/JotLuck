import type {
  InstalledThemePack,
  ThemeCatalogItem,
  ThemeCheckoutRequest,
  ThemeCheckoutResult,
  ThemeCommerceProvider,
  ThemeEntitlementDescriptor,
  ThemeLicenseRedeemRequest,
} from '@/types/theme-pack';

const ENTITLEMENTS_KEY = 'jotluck:themes:entitlements:v2';

function defaultEntitlement(pack: InstalledThemePack): ThemeEntitlementDescriptor {
  if (pack.source === 'builtin') {
    return {
      state: 'included',
      checkedAt: new Date(0).toISOString(),
      provider: 'local-mock',
    };
  }

  if (pack.source === 'imported' || pack.manifest.licenseKind === 'free') {
    return {
      state: 'free',
      checkedAt: new Date(0).toISOString(),
      provider: 'local-mock',
    };
  }

  return {
    state: pack.manifest.entitlement?.state ?? 'purchase-required',
    checkedAt: new Date(0).toISOString(),
    provider: 'local-mock',
    note: 'Mock entitlement. Replace ThemeCommerceProvider to connect Gumroad, Polar, or a custom backend.',
  };
}

function readStoredEntitlements(): Record<string, ThemeEntitlementDescriptor> {
  try {
    const raw = localStorage.getItem(ENTITLEMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ThemeEntitlementDescriptor>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredEntitlements(entitlements: Record<string, ThemeEntitlementDescriptor>): void {
  localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify(entitlements));
}

export function createMockThemeCommerceProvider(
  getThemes: () => readonly InstalledThemePack[],
): ThemeCommerceProvider {
  const provider: ThemeCommerceProvider = {
    id: 'local-mock',
    catalogEndpoint: '/v1/themes/catalog',
    entitlementsEndpoint: '/v1/themes/entitlements',
    checkoutEndpoint: '/v1/themes/checkout',
    redeemEndpoint: '/v1/themes/licenses/redeem',
    refreshEndpoint: '/v1/themes/entitlements/refresh',
    async getCatalog(): Promise<ThemeCatalogItem[]> {
      const entitlements = await provider.getEntitlements();
      return getThemes().map((pack) => ({
        manifest: pack.manifest,
        installed: pack.source === 'builtin' || pack.source === 'imported',
        entitlement: entitlements[pack.manifest.id] ?? defaultEntitlement(pack),
      }));
    },
    async getEntitlements(): Promise<Record<string, ThemeEntitlementDescriptor>> {
      const stored = readStoredEntitlements();
      const next: Record<string, ThemeEntitlementDescriptor> = { ...stored };
      for (const pack of getThemes()) {
        next[pack.manifest.id] = stored[pack.manifest.id] ?? defaultEntitlement(pack);
      }
      writeStoredEntitlements(next);
      return next;
    },
    async createCheckout(request: ThemeCheckoutRequest): Promise<ThemeCheckoutResult> {
      const pack = getThemes().find((theme) => theme.manifest.id === request.themeId);
      return {
        provider: 'local-mock',
        checkoutUrl:
          pack?.manifest.purchaseUrl ??
          `jotluck://themes/checkout?themeId=${encodeURIComponent(request.themeId)}`,
        state: 'local-mock',
      };
    },
    async redeemLicense(
      request: ThemeLicenseRedeemRequest,
    ): Promise<Record<string, ThemeEntitlementDescriptor>> {
      const entitlements = await provider.getEntitlements();
      entitlements[request.themeId] = {
        state: 'owned',
        licenseKey: request.licenseKey,
        checkedAt: new Date().toISOString(),
        provider: 'local-mock',
      };
      writeStoredEntitlements(entitlements);
      return entitlements;
    },
    async refreshEntitlements(): Promise<Record<string, ThemeEntitlementDescriptor>> {
      return provider.getEntitlements();
    },
  };

  return provider;
}
