<template>
  <Teleport to="body">
    <Transition name="notify">
      <div
        v-if="visible"
        class="update-card"
        role="status"
        aria-live="polite"
        aria-label="版本更新通知"
      >
        <!-- Timer bar -->
        <div class="timer-bar" :class="{ 'is-running': ticking }" @animationend="onTimerEnd" />

        <!-- Header -->
        <div class="card-header">🆕 MarkLuck {{ latestVersion }} 已发布</div>

        <!-- Body: release notes (first 2-3 lines, ~120 chars max) -->
        <p v-if="displayNotes" class="card-body">{{ displayNotes }}</p>

        <!-- Footer -->
        <div class="card-footer">
          <label class="dismiss-label">
            <input v-model="dontRemind" type="checkbox" class="dismiss-checkbox" />
            <span>本版本不再提醒</span>
          </label>
          <div class="footer-actions">
            <button class="link-btn" @click="openRelease">查看详情</button>
            <button class="close-btn" aria-label="关闭通知" title="关闭" @click="close">
              &#x2715;
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * UpdateNotification.vue — Startup version update notification
 *
 * Fixed card at bottom-right of the editor area. Appears on mount with a
 * 15-second auto-dismiss timer bar. Users can dismiss permanently per version.
 *
 * @emits update:visible — v-model binding to hide the card
 * @emits dismiss-version — user opts out of notifications for this version
 */
import { ref, watch, onUnmounted, computed } from 'vue';
import { normalizeUrl } from '@/utils/urlUtils';

// ─── Props ────────────────────────────────────────────────────────────

const props = defineProps<{
  /** Whether the notification card is visible. */
  visible: boolean;
  /** The latest version string (e.g. 'v0.2.0'). */
  latestVersion: string;
  /** URL to the GitHub release page. */
  releaseUrl: string;
  /** Release notes summary (first 2-3 lines displayed, max ~120 chars). */
  releaseNotes?: string;
}>();

// ─── Emits ─────────────────────────────────────────────────────────────

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'dismiss-version': [version: string];
}>();

// ─── State ─────────────────────────────────────────────────────────────

const dontRemind = ref(false);
const ticking = ref(false);
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Computed ──────────────────────────────────────────────────────────

const displayNotes = computed<string>(() => {
  if (!props.releaseNotes) return '';
  const lines = props.releaseNotes.split('\n').slice(0, 3);
  let text = lines.join(' ').trim();
  if (text.length > 120) text = text.slice(0, 120) + '…';
  return text;
});

// ─── Timer ─────────────────────────────────────────────────────────────

/**
 * Start the 15-second countdown. Uses double-rAF to force CSS animation
 * restart (handles the case where the parent uses v-show instead of v-if).
 * A JS setTimeout serves as a reliable fallback.
 */
function startTimer(): void {
  stopTimer();

  // Double rAF forces a style recalculation between class remove/add,
  // ensuring the CSS animation restarts from the beginning.
  ticking.value = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ticking.value = true;
    });
  });

  dismissTimer = setTimeout(() => {
    close();
  }, 15_000);
}

function stopTimer(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  ticking.value = false;
}

function onTimerEnd(e: AnimationEvent): void {
  // Guard: only respond to our own animation, and only once
  if (e.animationName !== 'timer-shrink') return;
  close();
}

// ─── Actions ───────────────────────────────────────────────────────────

function close(): void {
  stopTimer();
  if (dontRemind.value) {
    emit('dismiss-version', props.latestVersion);
  }
  emit('update:visible', false);
}

function openRelease(): void {
  window.open(normalizeUrl(props.releaseUrl), '_blank');
}

// ─── Watchers ──────────────────────────────────────────────────────────

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      dontRemind.value = false;
      startTimer();
    } else {
      stopTimer();
    }
  },
);

// ─── Lifecycle ─────────────────────────────────────────────────────────

onUnmounted(() => {
  stopTimer();
});
</script>

<style scoped>
/* ============================================================
 * Card — Fixed bottom-right
 * ============================================================ */
.update-card {
  position: fixed;
  bottom: var(--space-24);
  right: var(--space-24);
  z-index: var(--z-toast);
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  background: var(--paper-raised);
  border: var(--border-thin) solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-wing-float);

  /* Typography defaults */
  font-family: var(--ff-body);
  line-height: var(--lh-ui);

  /* Prevent interaction bleed */
  overflow: hidden;
}

/* ============================================================
 * Timer Bar
 * ============================================================ */
.timer-bar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: var(--accent);
  border-radius: var(--radius-full);
  transform-origin: left center;

  /* Start collapsed — animation expands and then shrinks */
  transform: scaleX(1);
}

.timer-bar.is-running {
  animation: timer-shrink 15s linear forwards;
}

@keyframes timer-shrink {
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0);
  }
}

/* ============================================================
 * Header
 * ============================================================ */
.card-header {
  padding: var(--space-12) var(--space-16) 0;
  font-size: var(--text-sm);
  font-weight: var(--fw-semibold);
  color: var(--ink-primary);
}

/* ============================================================
 * Body — Release Notes
 * ============================================================ */
.card-body {
  margin: 0;
  padding: 0 var(--space-16);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  line-height: var(--lh-body);
}

/* ============================================================
 * Footer Row
 * ============================================================ */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8) var(--space-16) var(--space-12);
  gap: var(--space-8);
}

/* ============================================================
 * Dismiss Checkbox
 * ============================================================ */
.dismiss-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--text-xs);
  color: var(--ink-muted);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  transition: color var(--dur-micro) var(--ease-fade);
}

.dismiss-label:hover {
  color: var(--ink-secondary);
}

.dismiss-checkbox {
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--accent);
  flex-shrink: 0;
}

/* ============================================================
 * Footer Actions
 * ============================================================ */
.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  flex-shrink: 0;
}

/* --- "查看详情" Link --- */
.link-btn {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  color: var(--accent);
  font-family: var(--ff-body);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--dur-micro) var(--ease-fade),
    opacity var(--dur-micro) var(--ease-fade);
}

.link-btn:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.link-btn:active {
  opacity: var(--opacity-inactive);
}

/* --- "✕" Close Button --- */
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-lg);
  height: var(--icon-lg);
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-muted);
  font-family: var(--ff-body);
  font-size: var(--text-sm);
  line-height: var(--lh-none);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    color var(--dur-micro) var(--ease-fade),
    background var(--dur-micro) var(--ease-fade);
}

.close-btn:hover {
  color: var(--ink-primary);
  background: var(--surface-hover);
}

.close-btn:active {
  background: var(--surface-active);
  transform: scale(0.92);
  transition: transform var(--dur-press) var(--ease-press);
}

/* ============================================================
 * Transition — Enter / Exit
 * ============================================================ */
.notify-enter-active {
  transition:
    opacity var(--dur-page) var(--ease-enter),
    transform var(--dur-page) var(--ease-enter);
}

.notify-leave-active {
  transition:
    opacity var(--dur-collapse) var(--ease-exit),
    transform var(--dur-collapse) var(--ease-exit);
}

.notify-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.notify-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
}
</style>
