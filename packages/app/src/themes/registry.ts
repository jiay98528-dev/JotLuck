/**
 * Theme Registry v2 — 聚合所有官方主题模块。
 *
 * 薄注册表：不包含任何主题元数据，只负责导入和 id 查询。
 * 每个模块通过自己的 `id` 字段声明唯一标识，注册表不做硬编码映射。
 */
import type { OfficialThemeModule } from '@/types/theme-pack';

import paperModule from './paper';

const ALL_MODULES: OfficialThemeModule[] = [paperModule];

const BY_ID = new Map<string, OfficialThemeModule>(ALL_MODULES.map((mod) => [mod.id, mod]));

export function getAllThemeModules(): OfficialThemeModule[] {
  return ALL_MODULES;
}

/** 按模块自声明的 id 精确查找（O(1)） */
export function getThemeModuleById(id: string): OfficialThemeModule | undefined {
  return BY_ID.get(id);
}
