export const WELCOME_COMPLETED_KEY = 'jotluck:welcome:completed';
export const WELCOME_REPLAY_EVENT = 'jotluck:welcome:replay';

export function hasCompletedWelcome(): boolean {
  return localStorage.getItem(WELCOME_COMPLETED_KEY) === '1';
}

export function markWelcomeCompleted(): void {
  localStorage.setItem(WELCOME_COMPLETED_KEY, '1');
}

export function requestWelcomeReplay(): void {
  localStorage.removeItem(WELCOME_COMPLETED_KEY);
  window.dispatchEvent(new Event(WELCOME_REPLAY_EVENT));
}
