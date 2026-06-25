<template>
  <div
    v-if="effectProfile !== 'none'"
    class="theme-effect-layer"
    :class="[
      `theme-effect-layer--${effectProfile}`,
      `theme-effect-layer--motion-${motionIntensity}`,
    ]"
    :data-effect-profile="effectProfile"
    :data-motion-intensity="motionIntensity"
    aria-hidden="true"
  >
    <span class="theme-effect-layer__pulse" />
    <span class="theme-effect-layer__glow theme-effect-layer__glow--one" />
    <span class="theme-effect-layer__glow theme-effect-layer__glow--two" />
    <span class="theme-effect-layer__dust theme-effect-layer__dust--one" />
    <span class="theme-effect-layer__dust theme-effect-layer__dust--two" />
    <span class="theme-effect-layer__dust theme-effect-layer__dust--three" />
  </div>
</template>

<script setup lang="ts">
import type { OfficialThemeUiProfile, ThemeEffectProfile } from '@/types/theme-pack';

withDefaults(
  defineProps<{
    effectProfile?: ThemeEffectProfile;
    motionIntensity?: OfficialThemeUiProfile['motionIntensity'];
  }>(),
  {
    effectProfile: 'none',
    motionIntensity: 'none',
  },
);
</script>

<style scoped>
.theme-effect-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  contain: layout paint;
}

.theme-effect-layer__pulse,
.theme-effect-layer__glow,
.theme-effect-layer__dust {
  position: absolute;
  display: block;
  pointer-events: none;
}

.theme-effect-layer__pulse {
  left: var(--space-32);
  right: var(--space-32);
  top: var(--topbar-height);
  height: var(--border-thin);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in oklch, var(--accent) 54%, transparent),
    transparent
  );
  opacity: 0.22;
  transform-origin: center;
  animation: theme-effect-pulse 4.2s var(--ease-fade) infinite;
}

.theme-effect-layer__glow {
  width: 280px;
  height: 280px;
  border-radius: var(--radius-full);
  background: radial-gradient(
    circle,
    color-mix(in oklch, var(--accent-soft) 68%, transparent) 0 18%,
    transparent 64%
  );
  filter: blur(2px);
  opacity: 0;
}

.theme-effect-layer__glow--one {
  left: 12%;
  top: 18%;
}

.theme-effect-layer__glow--two {
  right: 8%;
  bottom: 10%;
}

.theme-effect-layer__dust {
  width: 100%;
  height: 100%;
  background-repeat: repeat;
  opacity: 0;
}

.theme-effect-layer__dust--one {
  background-image: radial-gradient(
    circle,
    color-mix(in oklch, var(--ink-muted) 38%, transparent) 0 1px,
    transparent 1.5px
  );
  background-size: 96px 96px;
}

.theme-effect-layer__dust--two {
  background-image: radial-gradient(
    circle,
    color-mix(in oklch, var(--accent) 42%, transparent) 0 1px,
    transparent 1.5px
  );
  background-position: 28px 18px;
  background-size: 136px 136px;
}

.theme-effect-layer__dust--three {
  background-image: radial-gradient(
    circle,
    color-mix(in oklch, var(--paper-raised) 46%, transparent) 0 1px,
    transparent 2px
  );
  background-position: 42px 12px;
  background-size: 168px 168px;
}

.theme-effect-layer--subtle .theme-effect-layer__pulse {
  opacity: 0.18;
  animation-duration: 5.6s;
}

.theme-effect-layer--subtle .theme-effect-layer__dust--one {
  opacity: 0.08;
}

.theme-effect-layer--ambient .theme-effect-layer__pulse {
  opacity: 0.34;
}

.theme-effect-layer--ambient .theme-effect-layer__dust--one,
.theme-effect-layer--ambient .theme-effect-layer__dust--two {
  opacity: 0.16;
  animation: theme-effect-drift 22s linear infinite;
}

.theme-effect-layer--ambient .theme-effect-layer__glow--one {
  opacity: 0.18;
  animation: theme-effect-breathe 7s var(--ease-fade) infinite;
}

.theme-effect-layer--immersive .theme-effect-layer__pulse {
  opacity: 0.44;
  animation-duration: 3.8s;
}

.theme-effect-layer--immersive .theme-effect-layer__dust {
  opacity: 0.24;
  animation: theme-effect-drift 26s linear infinite;
}

.theme-effect-layer--immersive .theme-effect-layer__glow {
  opacity: 0.24;
  animation: theme-effect-breathe 6.5s var(--ease-fade) infinite;
}

.theme-effect-layer--motion-low .theme-effect-layer__pulse,
.theme-effect-layer--motion-low .theme-effect-layer__dust,
.theme-effect-layer--motion-low .theme-effect-layer__glow {
  animation-duration: 12s;
}

@keyframes theme-effect-pulse {
  0%,
  100% {
    opacity: 0.18;
    transform: scaleX(0.72);
  }

  50% {
    opacity: 0.56;
    transform: scaleX(1);
  }
}

@keyframes theme-effect-drift {
  from {
    transform: translate3d(0, 0, 0);
  }

  to {
    transform: translate3d(18px, -12px, 0);
  }
}

@keyframes theme-effect-breathe {
  0%,
  100% {
    transform: scale(0.94);
  }

  50% {
    transform: scale(1.05);
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-effect-layer__pulse,
  .theme-effect-layer__dust,
  .theme-effect-layer__glow {
    animation: none;
  }
}
</style>
