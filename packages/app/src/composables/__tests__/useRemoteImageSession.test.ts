import { afterEach, describe, expect, it } from 'vitest';
import type { RemoteImageLabels } from '@jotluck/renderer';
import { useRemoteImageSession } from '../useRemoteImageSession';

const labels: RemoteImageLabels = {
  blocked: 'blocked',
  source: 'source',
  loadAll: 'load all',
  loading: 'loading',
  failed: 'failed',
  retry: 'retry',
  insecure: 'insecure',
  unnamed: 'image',
};

afterEach(() => document.body.replaceChildren());

function generatedAction(
  session: ReturnType<typeof useRemoteImageSession>,
  action: 'load-all' | 'retry',
  source: string,
): HTMLButtonElement {
  const placeholder = document.createElement('span');
  placeholder.className = 'remote-image-placeholder';
  const button = document.createElement('button');
  button.className = 'remote-image-placeholder__action';
  button.dataset.remoteImageControl = 'v1';
  button.dataset.remoteImageScope = session.createPolicy(labels).scopeId;
  button.dataset.remoteImageAction = action;
  button.dataset.remoteImageSource = source;
  placeholder.append(button);
  document.body.append(placeholder);
  button.addEventListener('click', (event) => session.handleClick(event));
  return button;
}

function authorize(session: ReturnType<typeof useRemoteImageSession>, source: string): void {
  generatedAction(session, 'load-all', source).click();
}

function generatedImage(
  session: ReturnType<typeof useRemoteImageSession>,
  source: string,
  alt: string,
): HTMLImageElement {
  const policy = session.createPolicy(labels);
  const wrapper = document.createElement('span');
  wrapper.className = 'remote-image remote-image--loading';
  wrapper.dataset.remoteImageScope = policy.scopeId;
  wrapper.dataset.remoteImageSource = source;
  const image = document.createElement('img');
  image.alt = alt;
  image.dataset.remoteImageControl = 'v1';
  image.dataset.remoteImageScope = policy.scopeId;
  image.dataset.remoteImageSource = source;
  wrapper.append(image);
  document.body.append(wrapper);
  return image;
}

describe('useRemoteImageSession', () => {
  it('authorizes all HTTPS images in only the active note scope', () => {
    const session = useRemoteImageSession();
    session.setScope('C:/notes', '/one.md');
    const sourceA = 'https://a.example/image.png';
    const sourceB = 'https://b.example/image.png';
    expect(session.createPolicy(labels).decide(sourceA)).toBe('blocked');

    authorize(session, sourceA);
    expect(session.createPolicy(labels).decide(sourceA)).toBe('allowed');
    expect(session.createPolicy(labels).decide(sourceB)).toBe('allowed');

    session.setScope('C:/notes', '/two.md');
    expect(session.createPolicy(labels).decide(sourceA)).toBe('blocked');
    session.setScope('C:/notes', '/one.md');
    expect(session.createPolicy(labels).decide(sourceA)).toBe('allowed');
  });

  it('isolates identical note paths across notebook roots and resets in a new instance', () => {
    const session = useRemoteImageSession();
    const source = 'https://a.example/image.png';
    session.setScope('C:/one', '/note.md');
    authorize(session, source);
    session.setScope('C:/two', '/note.md');
    expect(session.createPolicy(labels).decide(source)).toBe('blocked');

    const fresh = useRemoteImageSession();
    fresh.setScope('C:/one', '/note.md');
    expect(fresh.createPolicy(labels).decide(source)).toBe('blocked');
  });

  it('rejects forged controls, stale scopes and unsafe URLs', () => {
    const session = useRemoteImageSession();
    session.setScope('C:/notes', '/note.md');
    const policy = session.createPolicy(labels);
    const forged = document.createElement('a');
    forged.className = 'remote-image-placeholder__action';
    forged.dataset.remoteImageControl = 'v1';
    forged.dataset.remoteImageAction = 'load-all';
    forged.dataset.remoteImageScope = policy.scopeId;
    forged.dataset.remoteImageSource = 'https://a.example/image.png';
    const forgedEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(forgedEvent, 'target', { value: forged });
    expect(session.handleClick(forgedEvent)).toBe(false);

    const stale = generatedAction(session, 'load-all', 'https://a.example/image.png');
    stale.dataset.remoteImageScope = 'remote-image-scope-stale';
    stale.click();
    const unsafe = generatedAction(session, 'load-all', 'http://a.example/image.png');
    unsafe.click();
    expect(session.createPolicy(labels).decide('https://a.example/image.png')).toBe('blocked');
  });

  it('updates only the failed image in place and retries without a global revision', () => {
    const session = useRemoteImageSession();
    const failedSource = 'https://a.example/fail.png';
    const okSource = 'https://a.example/ok.png';
    session.setScope('C:/notes', '/note.md');
    authorize(session, failedSource);
    const revisionAfterAuthorization = session.revision.value;
    const failedImage = generatedImage(session, failedSource, 'failed image');
    const siblingImage = generatedImage(session, okSource, 'sibling image');
    failedImage.addEventListener('error', session.handleError);
    failedImage.dispatchEvent(new Event('error'));

    expect(session.revision.value).toBe(revisionAfterAuthorization);
    expect(document.body.contains(siblingImage)).toBe(true);
    expect(session.createPolicy(labels).decide(failedSource)).toBe('failed');
    expect(session.createPolicy(labels).decide(okSource)).toBe('allowed');
    const retry = document.querySelector<HTMLButtonElement>('[data-remote-image-action="retry"]');
    expect(retry).not.toBeNull();
    retry!.addEventListener('click', (event) => session.handleClick(event));
    retry!.click();

    expect(session.revision.value).toBe(revisionAfterAuthorization);
    expect(document.body.contains(siblingImage)).toBe(true);
    expect(session.createPolicy(labels).decide(failedSource)).toBe('allowed');
    expect(
      document.querySelector(`img[data-remote-image-source="${failedSource}"]`),
    ).not.toBeNull();
  });
});
