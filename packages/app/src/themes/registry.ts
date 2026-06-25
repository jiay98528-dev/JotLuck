/**
 * Theme Registry v2 — 聚合所有官方主题模块。
 *
 * 薄注册表：不包含任何主题定义，只负责导入和查询。
 */
import type { OfficialThemeModule } from '@/types/theme-pack';

import paperModule from './paper';
import inkStudyModule from './ink-study';
import archiveModule from './archive';
import readerNocturneModule from './reader-nocturne';
import studioModule from './studio';

const ALL_MODULES: OfficialThemeModule[] = [
  paperModule,
  inkStudyModule,
  archiveModule,
  readerNocturneModule,
  studioModule,
];

const MODULE_MAP = new Map<string, OfficialThemeModule>(
  ALL_MODULES.map((mod) => [mod.meta.role, mod]),
);

// 用 meta 中的 id 做二次索引（兼容遗留代码通过 id 查找）
// 当前 OfficialThemeProfile 没有 id 字段——实际查找用 builtInThemes 的 manifest.id
// v2 模块查找通过 role/meta 匹配

export function getAllThemeModules(): OfficialThemeModule[] {
  return ALL_MODULES;
}

export function getThemeModule(role: string): OfficialThemeModule | undefined {
  return MODULE_MAP.get(role);
}

export function getThemeModuleById(id: string): OfficialThemeModule | undefined {
  if (id === 'markluck.ink-study') return inkStudyModule;
  if (id === 'markluck.archive') return archiveModule;
  if (id === 'markluck.reader-nocturne') return readerNocturneModule;
  if (id === 'markluck.studio') return studioModule;
  if (id === 'paper') return paperModule;
  return undefined;
}
