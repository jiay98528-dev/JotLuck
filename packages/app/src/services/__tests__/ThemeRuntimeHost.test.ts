import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateTrustedThemeRuntime,
  getThemeSlotComponent,
  unregisterTrustedTheme,
} from '@/services/ThemeRuntimeHost';
import { getAllRegistryThemePacks } from '@/services/ThemeRegistry';
import type {
  InstalledThemePack,
  OfficialThemeModule,
  ShellRecipe,
  ThemeChromeState,
} from '@/types/theme-pack';

const recipe: ShellRecipe = {
  layoutPreset: 'atelier',
  workspaceIntent: 'atelier',
  defaultViewMode: 'split',
  topBar: { variant: 'atelier', layout: 'workbench' },
  leftWing: { mode: 'navigator', layout: 'navigator' },
  editorControl: { layout: 'stacked', density: 'productive' },
  statusBar: { layout: 'dashboard', density: 'productive' },
  rightWing: {
    mode: 'atlas',
    policy: 'atlas',
    sections: ['outline', 'backlinks', 'tags'],
    defaultOpenSections: ['outline'],
  },
  readingWidth: 'wide',
  drawerEmphasis: 'high',
  motionIntensity: 'high',
  actionPlacements: {
    'new-note': 'topbar-left',
    'file-drawer': 'topbar-left',
    search: 'topbar-center',
    template: 'editor-control',
    export: 'status-right',
    share: 'status-right',
    theme: 'topbar-right',
    settings: 'topbar-right',
    'view-toggle': 'reader-bar',
  },
};

const chrome: ThemeChromeState = {
  official: true,
  layoutPreset: recipe.layoutPreset,
  role: 'workflow',
  topBarVariant: recipe.topBar.variant,
  leftWingMode: recipe.leftWing.mode,
  rightWingMode: recipe.rightWing.mode,
  toolbarDensity: recipe.editorControl.density,
  statusDensity: recipe.statusBar.density,
  drawerEmphasis: recipe.drawerEmphasis,
  readingWidth: recipe.readingWidth,
  effectProfile: 'immersive',
  motionIntensity: recipe.motionIntensity,
  rightWingSections: recipe.rightWing.sections,
  defaultOpenSections: recipe.rightWing.defaultOpenSections,
  workspaceIntent: recipe.workspaceIntent,
  defaultViewMode: recipe.defaultViewMode,
  topBarLayout: recipe.topBar.layout,
  leftWingLayout: recipe.leftWing.layout,
  editorControlLayout: recipe.editorControl.layout,
  statusLayout: recipe.statusBar.layout,
  rightWingPolicy: recipe.rightWing.policy,
  actionPlacements: recipe.actionPlacements,
};

describe('ThemeRuntimeHost', () => {
  beforeEach(() => {
    localStorage.clear();
    unregisterTrustedTheme('jotluck.test-plugin');
    unregisterTrustedTheme('jotluck.halo-canvas');
  });

  it('activates an official full UX plugin and unregisters slot components', async () => {
    const TopbarPlugin = defineComponent({ name: 'TopbarPlugin', template: '<div />' });
    let disposed = false;
    const module: OfficialThemeModule = {
      id: 'jotluck.test-plugin',
      name: 'Test Plugin',
      tags: ['test'],
      capabilities: ['tokens', 'layout-preset', 'ux-components', 'trusted-code'],
      meta: {
        role: 'workflow',
        headline: 'test',
        story: 'test',
        bestFor: ['test'],
        visualFeatures: ['test'],
        uiProfile: {
          toolbarDensity: 'productive',
          sidebarMode: 'research',
          drawerEmphasis: 'high',
          readingWidth: 'wide',
          motionIntensity: 'high',
        },
        performanceLevel: 5,
        effectProfile: 'immersive',
      },
      recipe,
      tokens: {},
      plugin: {
        activate(context) {
          context.storage.set('activated', context.themeId);
          return () => {
            disposed = true;
          };
        },
        components: {
          topbar: TopbarPlugin,
        },
      },
    };
    const pack: InstalledThemePack = {
      manifest: {
        id: module.id,
        version: '1.0.0',
        themeApi: 2,
        runtime: 'official-code',
        minAppVersion: '0.15.0',
        name: module.name,
        author: 'JotLuck',
        capabilities: module.capabilities,
        permissions: ['shell-layout', 'component-replace', 'visual-effects', 'theme-storage'],
        layoutPreset: 'atelier',
        checksums: {},
      },
      css: '',
      source: 'market',
      installedAt: 0,
      module,
    };

    await activateTrustedThemeRuntime(pack, [], chrome);

    expect(getThemeSlotComponent(module.id, 'topbar')).toBe(TopbarPlugin);
    expect(localStorage.getItem(`jotluck:theme:${module.id}:activated`)).toBe(module.id);

    unregisterTrustedTheme(module.id);

    expect(disposed).toBe(true);
    expect(getThemeSlotComponent(module.id, 'topbar')).toBeUndefined();
  });

  it('activates Halo Canvas on its documented slots and unregisters the runtime cleanly', async () => {
    const pack = getAllRegistryThemePacks().find(
      (candidate) => candidate.manifest.id === 'jotluck.halo-canvas',
    );
    const expectedSlots = [
      'topbar',
      'left-wing',
      'right-wing',
      'editor-control',
      'status-bar',
      'workflow-canvas',
      'editor-surface',
      'external-reader',
    ] as const;

    expect(pack).toBeDefined();
    await activateTrustedThemeRuntime(pack!, [], chrome);

    for (const slot of expectedSlots) {
      expect(getThemeSlotComponent(pack!.manifest.id, slot)).toBeDefined();
    }
    expect(getThemeSlotComponent(pack!.manifest.id, 'dialogs.theme')).toBeUndefined();
    expect(getThemeSlotComponent(pack!.manifest.id, 'file-drawer')).toBeUndefined();
    expect(getThemeSlotComponent(pack!.manifest.id, 'command-palette')).toBeUndefined();

    unregisterTrustedTheme(pack!.manifest.id);

    for (const slot of expectedSlots) {
      expect(getThemeSlotComponent(pack!.manifest.id, slot)).toBeUndefined();
    }
  });

  it('revokes the dynamic runtime URL when activation fails after import', async () => {
    const themeId = 'jotluck.runtime-failure';
    const objectUrl = `data:text/javascript,${encodeURIComponent(
      'export default { activate() { throw new Error("activation failed") } }',
    )}`;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn().mockReturnValue(objectUrl);
    const revokeObjectUrl = vi.fn().mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    const pack: InstalledThemePack = {
      manifest: {
        id: themeId,
        version: '1.0.0',
        themeApi: 2,
        runtime: 'trusted-code',
        minAppVersion: '0.15.0',
        name: 'Runtime Failure',
        author: 'JotLuck',
        capabilities: ['trusted-code'],
        permissions: ['component-replace'],
        layoutPreset: 'atelier',
        checksums: {},
        entrypoints: [{ slot: 'topbar', module: 'runtime.js', checksum: 'test' }],
      },
      css: '',
      source: 'imported',
      installedAt: 0,
      codeBundles: { 'runtime.js': 'export default {}' },
    };

    await expect(activateTrustedThemeRuntime(pack, [], chrome)).rejects.toThrow(
      'activation failed',
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(objectUrl);

    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    } else {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: undefined,
      });
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    } else {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: undefined,
      });
    }
    unregisterTrustedTheme(themeId);
  });
});
