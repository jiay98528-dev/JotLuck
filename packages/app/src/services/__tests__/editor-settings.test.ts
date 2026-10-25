import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_DELAY_DEFAULT,
  DEFAULT_EDITOR_SETTINGS,
  EDITOR_SETTINGS_EVENT,
  EDITOR_SETTINGS_KEY,
  getEditorSettings,
  saveEditorSettings,
  subscribeEditorSettings,
  updateEditorSettings,
  type EditorSettings,
} from '../editor-settings';

/**
 * 编辑器设置服务契约：设置页六控件的唯一持久化与通知源。
 * - 默认值必须对齐接线前实际行为（接线即生效但零突变）；
 * - 载荷为 { version, settings } 结构化信封，读不到/读不懂（更高版本）一律回落默认；
 * - 越界值钳回滑杆边界；订阅链覆盖自定义事件与 storage 事件两条通路。
 */
describe('editor-settings service', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认值对齐接线前实际行为：16px / 1.8 行高 / Tab 2 空格 / 恒换行 / 自动保存 600ms', () => {
    expect(DEFAULT_EDITOR_SETTINGS).toEqual({
      fontSize: 16,
      lineHeight: 1.8,
      tabSize: 2,
      wordWrap: true,
      autoSaveEnabled: true,
      autoSaveDelay: 600,
    });
    expect(AUTOSAVE_DELAY_DEFAULT).toBe(600);
    expect(getEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('saveEditorSettings 写入版本化信封并广播；getEditorSettings 读回同值', () => {
    const next: EditorSettings = { ...DEFAULT_EDITOR_SETTINGS, fontSize: 20, autoSaveDelay: 1500 };
    const listener = vi.fn();
    const unsubscribe = subscribeEditorSettings(listener);

    saveEditorSettings(next);

    const raw = localStorage.getItem(EDITOR_SETTINGS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ version: 1, settings: next });
    expect(listener).toHaveBeenCalledWith(next);
    expect(getEditorSettings()).toEqual(next);
    unsubscribe();
  });

  it('updateEditorSettings 合并写入并钳制：延迟/字号/行高钳回滑杆边界，tabSize 仅 2/4 两档', () => {
    const result = updateEditorSettings({
      autoSaveDelay: 100,
      fontSize: 99,
      lineHeight: 9,
      tabSize: 3,
    });

    expect(result).toEqual({
      ...DEFAULT_EDITOR_SETTINGS,
      autoSaveDelay: 500,
      fontSize: 24,
      lineHeight: 2.5,
      tabSize: 2,
    });

    const upper = updateEditorSettings({ autoSaveDelay: 99999, tabSize: 4 });
    expect(upper.autoSaveDelay).toBe(10000);
    expect(upper.tabSize).toBe(4);
  });

  it('信封版本位：未知更高版本按读不懂处理，回落默认（迁移位 fail-safe）', () => {
    localStorage.setItem(
      EDITOR_SETTINGS_KEY,
      JSON.stringify({ version: 99, settings: { fontSize: 20, autoSaveDelay: 8000 } }),
    );
    expect(getEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('损坏载荷（非 JSON / 非对象信封 / settings 非对象）回落默认', () => {
    localStorage.setItem(EDITOR_SETTINGS_KEY, '{not-json');
    expect(getEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);

    localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify({ version: 1, settings: 42 }));
    expect(getEditorSettings()).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('订阅链：跨窗口 storage 事件（同键）触发监听，其它键不触发', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEditorSettings(listener);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'jotluck:other-key',
        newValue: '{}',
      }),
    );
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: EDITOR_SETTINGS_KEY,
        newValue: JSON.stringify({ version: 1, settings: { ...DEFAULT_EDITOR_SETTINGS } }),
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();

    window.dispatchEvent(new CustomEvent(EDITOR_SETTINGS_EVENT));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
