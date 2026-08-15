import { ref, type Ref } from 'vue';
import type { RemoteImageLabels, RemoteImagePolicy } from '@jotluck/renderer';

export interface RemoteImageSession {
  revision: Ref<number>;
  setScope: (root: string, path: string) => void;
  createPolicy: (labels: RemoteImageLabels) => RemoteImagePolicy;
  handleClick: (event: MouseEvent) => boolean;
  handleLoad: (event: Event) => boolean;
  handleError: (event: Event) => boolean;
}

function normalizedScopePart(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

function validHttpsSource(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function appendPlaceholderCopy(
  placeholder: HTMLElement,
  alt: string,
  source: string,
  labels: RemoteImageLabels,
): void {
  const title = document.createElement('span');
  title.className = 'remote-image-placeholder__title';
  title.textContent = alt || labels.unnamed;
  const detail = document.createElement('span');
  detail.className = 'remote-image-placeholder__detail';
  detail.textContent = `${labels.failed} · ${labels.source}: ${new URL(source).host}`;
  placeholder.append(title, detail);
}

export function useRemoteImageSession(): RemoteImageSession {
  const revision = ref(0);
  const authorizedScopes = new Set<string>();
  const failedByScope = new Map<string, Set<string>>();
  const labelsByScope = new Map<string, RemoteImageLabels>();
  const scopeIds = new Map<string, string>();
  let nextScopeId = 1;
  let currentScope = '';

  function setScope(root: string, path: string): void {
    const scopeKey = `${normalizedScopePart(root)}\u0000${normalizedScopePart(path)}`;
    let scopeId = scopeIds.get(scopeKey);
    if (!scopeId) {
      scopeId = `remote-image-scope-${nextScopeId++}`;
      scopeIds.set(scopeKey, scopeId);
    }
    if (scopeId === currentScope) return;
    currentScope = scopeId;
    revision.value++;
  }

  function createPolicy(labels: RemoteImageLabels): RemoteImagePolicy {
    const scope = currentScope;
    labelsByScope.set(scope, labels);
    return {
      labels,
      scopeId: scope,
      decide(source) {
        if (failedByScope.get(scope)?.has(source)) return 'failed';
        return authorizedScopes.has(scope) ? 'allowed' : 'blocked';
      },
    };
  }

  function generatedActionButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>('button.remote-image-placeholder__action');
    if (
      !button ||
      button.dataset.remoteImageControl !== 'v1' ||
      button.dataset.remoteImageScope !== currentScope ||
      !button.parentElement?.classList.contains('remote-image-placeholder')
    ) {
      return null;
    }
    const source = button.dataset.remoteImageSource;
    return source && validHttpsSource(source) === source ? button : null;
  }

  function replaceFailedPlaceholderWithImage(
    button: HTMLButtonElement,
    source: string,
    scope: string,
  ): boolean {
    const placeholder = button.parentElement;
    const labels = labelsByScope.get(scope);
    if (!placeholder || !labels) return false;
    const alt = placeholder.querySelector('.remote-image-placeholder__title')?.textContent ?? '';
    const wrapper = document.createElement('span');
    wrapper.className = 'remote-image remote-image--loading';
    wrapper.dataset.remoteImageSource = source;
    wrapper.dataset.remoteImageScope = scope;
    const status = document.createElement('span');
    status.className = 'remote-image__status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = labels.loading;
    const image = document.createElement('img');
    image.alt = alt || labels.unnamed;
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.dataset.remoteImageControl = 'v1';
    image.dataset.remoteImageSource = source;
    image.dataset.remoteImageScope = scope;
    wrapper.append(status, image);
    placeholder.replaceWith(wrapper);
    image.src = source;
    return true;
  }

  function handleClick(event: MouseEvent): boolean {
    const button = generatedActionButton(event.target);
    if (!button) return false;
    const action = button.dataset.remoteImageAction;
    const source = button.dataset.remoteImageSource!;
    const scope = button.dataset.remoteImageScope!;
    if (action !== 'load-all' && action !== 'retry') return false;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'load-all') {
      authorizedScopes.add(scope);
      revision.value++;
      return true;
    }

    failedByScope.get(scope)?.delete(source);
    authorizedScopes.add(scope);
    return replaceFailedPlaceholderWithImage(button, source, scope);
  }

  function generatedRemoteImage(target: EventTarget | null): HTMLImageElement | null {
    if (!(target instanceof HTMLImageElement)) return null;
    const source = target.dataset.remoteImageSource;
    const scope = target.dataset.remoteImageScope;
    const wrapper = target.parentElement;
    if (
      target.dataset.remoteImageControl !== 'v1' ||
      scope !== currentScope ||
      !source ||
      validHttpsSource(source) !== source ||
      !wrapper?.classList.contains('remote-image') ||
      wrapper.dataset.remoteImageScope !== scope ||
      wrapper.dataset.remoteImageSource !== source
    ) {
      return null;
    }
    return target;
  }

  function handleLoad(event: Event): boolean {
    const target = generatedRemoteImage(event.target);
    if (!target) return false;
    const wrapper = target.parentElement!;
    wrapper.classList.remove('remote-image--loading');
    wrapper.classList.add('remote-image--loaded');
    wrapper.querySelector('.remote-image__status')?.remove();
    return true;
  }

  function handleError(event: Event): boolean {
    const target = generatedRemoteImage(event.target);
    if (!target) return false;
    const source = target.dataset.remoteImageSource!;
    const scope = target.dataset.remoteImageScope!;
    const labels = labelsByScope.get(scope);
    if (!labels) return false;
    const failed = failedByScope.get(scope) ?? new Set<string>();
    failed.add(source);
    failedByScope.set(scope, failed);

    const placeholder = document.createElement('span');
    placeholder.className = 'remote-image-placeholder remote-image-placeholder--failed';
    placeholder.setAttribute('role', 'group');
    appendPlaceholderCopy(placeholder, target.alt, source, labels);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remote-image-placeholder__action';
    button.dataset.remoteImageControl = 'v1';
    button.dataset.remoteImageAction = 'retry';
    button.dataset.remoteImageSource = source;
    button.dataset.remoteImageScope = scope;
    button.textContent = labels.retry;
    placeholder.append(button);
    target.parentElement!.replaceWith(placeholder);
    return true;
  }

  return { revision, setScope, createPolicy, handleClick, handleLoad, handleError };
}
