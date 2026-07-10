import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateTrustedThemeRuntime,
  getThemeSlotComponent,
  unregisterTrustedTheme,
} from '@/services/ThemeRuntimeHost';
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
});
