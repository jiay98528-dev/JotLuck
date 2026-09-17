import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.resolve(import.meta.dirname, '../../packages/app/src-tauri/src/lib.rs'),
  'utf8',
);

describe('desktop cold-start window contract', () => {
  it('registers the startup session before creating a WebView', () => {
    const setup = source.slice(
      source.indexOf('.setup(move |app|'),
      source.indexOf('.invoke_handler('),
    );
    expect(setup).not.toContain('build_window(');
    expect(setup).toContain('open_external_file_in_window(app.handle(), first, Some("main"))?');
    expect(setup).toContain(
      '#[cfg(not(target_os = "macos"))]\n                create_workspace_window(app.handle(), "main")?',
    );
  });

  it('decides on the macOS default editor only after launch events have drained', () => {
    const drained = source.slice(
      source.indexOf('tauri::RunEvent::MainEventsCleared if initial_event_batch'),
      source.indexOf('tauri::RunEvent::Opened { urls }'),
    );
    expect(drained).toContain('initial_event_batch = false;');
    expect(drained).toContain('if app.webview_windows().is_empty()');
    expect(drained).toContain('create_workspace_window(app, "main")');
    expect(source).toContain('if !initial_event_batch && app.webview_windows().is_empty()');
  });

  it('opens LaunchServices files synchronously before the default-window decision', () => {
    const opened = source.slice(source.indexOf('tauri::RunEvent::Opened { urls }'));
    expect(opened).toContain('open_external_file_in_window(app, &path, None)');
    expect(opened).not.toContain('open_secondary_invocation(');
  });
});
