/**
 * Theme Registry v2 — 聚合所有官方主题模块。
 *
 * 薄注册表：不包含任何主题元数据，只负责导入和 id 查询。
 * 每个模块通过自己的 `id` 字段声明唯一标识，注册表不做硬编码映射。
 */
import type { OfficialThemeModule } from '@/types/theme-pack';

import createPaperModule from './paper';

export function getAllThemeModules(): OfficialThemeModule[] {
  return [createPaperModule()];
}

/** 按模块自声明的 id 精确查找（O(1)） */
export function getThemeModuleById(id: string): OfficialThemeModule | undefined {
  return getAllThemeModules().find((module) => module.id === id);
}
