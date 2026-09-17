/** Window adapter for the process-wide desktop update service. */
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { APP_VERSION } from '@/config/app-meta';
import { isDesktopRuntime } from '@/utils/runtime';
import { translate } from '@/i18n';

export type UpdateChannel = 'stable' | 'preview';
export interface UpdateCandidate {
  version: string;
  releaseUrl: string;
  notes: string;
  downloadUrl: string | null;
  source: 'website' | 'github' | 'confirmed';
}
export interface UpdateState {
  revision: number;
  currentVersion: string;
  channel: UpdateChannel;
  autoCheck: boolean;
  status:
    | 'idle'
    | 'checking'
    | 'latest'
    | 'available'
    | 'unverified'
    | 'outOfSync'
    | 'unsupported'
    | 'failed';
  candidate: UpdateCandidate | null;
  lastChecked: number | null;
  welcomeCompleted: boolean;
  welcomeRevision: string | null;
}
export const WELCOME_CONTENT_REVISION = 'updates-opt-in-v1';
const state = ref<UpdateState>({
  revision: 0,
  currentVersion: APP_VERSION,
  channel: APP_VERSION.includes('-') ? 'preview' : 'stable',
  autoCheck: false,
  status: 'idle',
  candidate: null,
  lastChecked: null,
  welcomeCompleted: false,
  welcomeRevision: null,
});
const error = ref<string | null>(null);
const saving = ref(false);
let initialization: Promise<void> | null = null;
let unlisten: UnlistenFn | null = null;
let browserWelcomeOwner = false;
function legacy() {
  try {
    return {
      autoCheck: localStorage.getItem('jotluck:version:autoCheck') === 'true',
      welcomeCompleted: localStorage.getItem('jotluck:welcome:completed') === '1',
    };
  } catch {
    return { autoCheck: false, welcomeCompleted: false };
  }
}
function apply(next: UpdateState) {
  if (next.revision >= state.value.revision) state.value = next;
}
async function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!isDesktopRuntime()) {
      const old = legacy();
      let revision: string | null = null;
      try {
        revision = localStorage.getItem('jotluck:welcome:revision');
      } catch {
        /* optional browser storage */
      }
      state.value = { ...state.value, ...old, welcomeRevision: revision };
      return;
    }
    // Listen before reading the snapshot; revisions resolve event/read races.
    unlisten = await listen<UpdateState>('jotluck://update-state', ({ payload }) => apply(payload));
    apply(await invoke<UpdateState>('get_update_state', { legacy: legacy() }));
  })().catch(() => {
    unlisten?.();
    unlisten = null;
    initialization = null;
    error.value = translate('settings.updates.failed');
    throw new Error('update initialization failed');
  });
  return initialization;
}

export function useVersionCheck() {
  async function setPreferences(autoCheck: boolean, channel = state.value.channel) {
    if (saving.value) return;
    saving.value = true;
    error.value = null;
    try {
      await initialize();
      if (isDesktopRuntime())
        apply(await invoke<UpdateState>('set_update_preferences', { autoCheck, channel }));
      else {
        localStorage.setItem('jotluck:version:autoCheck', String(autoCheck));
        state.value = { ...state.value, autoCheck, channel };
      }
    } catch {
      error.value = translate('updateService.saveFailed');
    } finally {
      saving.value = false;
    }
  }
  async function checkNow() {
    error.value = null;
    try {
      await initialize();
      if (!isDesktopRuntime()) {
        error.value = translate('updateService.desktopOnly');
        return;
      }
      apply(await invoke<UpdateState>('check_for_updates'));
    } catch {
      error.value = translate('settings.updates.failed');
    }
  }
  async function claimWelcome(replay = false): Promise<{ show: boolean; mode: 'new' | 'upgrade' }> {
    await initialize();
    if (isDesktopRuntime()) return invoke('claim_welcome', { replay });
    const show =
      !browserWelcomeOwner && (replay || state.value.welcomeRevision !== WELCOME_CONTENT_REVISION);
    browserWelcomeOwner = show || browserWelcomeOwner;
    return { show, mode: !replay && state.value.welcomeCompleted ? 'upgrade' : 'new' };
  }
  async function completeWelcome() {
    error.value = null;
    try {
      if (isDesktopRuntime()) apply(await invoke<UpdateState>('complete_welcome'));
      else {
        localStorage.setItem('jotluck:welcome:completed', '1');
        localStorage.setItem('jotluck:welcome:revision', WELCOME_CONTENT_REVISION);
        state.value = {
          ...state.value,
          welcomeCompleted: true,
          welcomeRevision: WELCOME_CONTENT_REVISION,
        };
        browserWelcomeOwner = false;
      }
      return true;
    } catch {
      error.value = translate('updateService.saveFailed');
      return false;
    }
  }
  async function releaseWelcome() {
    if (isDesktopRuntime()) await invoke('release_welcome');
    else browserWelcomeOwner = false;
  }
  async function dismissVersion(version: string) {
    try {
      if (isDesktopRuntime())
        apply(await invoke<UpdateState>('dismiss_update_version', { version }));
    } catch {
      error.value = translate('updateService.saveFailed');
    }
  }
  async function claimNotification(): Promise<boolean> {
    if (!isDesktopRuntime()) return false;
    return invoke('claim_update_notification');
  }
  return {
    state,
    error,
    saving,
    initialize,
    setPreferences,
    checkNow,
    claimWelcome,
    completeWelcome,
    releaseWelcome,
    dismissVersion,
    claimNotification,
    autoCheck: computed(() => state.value.autoCheck),
    checking: computed(() => state.value.status === 'checking'),
    hasUpdate: computed(
      () => ['available', 'unverified'].includes(state.value.status) && !!state.value.candidate,
    ),
    latestVersion: computed(() => state.value.candidate?.version ?? ''),
    currentVersion: computed(() => state.value.currentVersion),
    releaseUrl: computed(() =>
      state.value.candidate?.source === 'website'
        ? 'https://jotluck.com/'
        : (state.value.candidate?.releaseUrl ?? ''),
    ),
    releaseNotes: computed(() => state.value.candidate?.notes ?? ''),
    lastChecked: computed(() => state.value.lastChecked),
    autoInstallAvailable: computed(() => false),
  };
}
