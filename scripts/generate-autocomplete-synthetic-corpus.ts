/**
 * Deterministic project-owned short-note corpus generator.
 *
 * The generated files are approved, project-owned inputs, but remain local
 * reproducible artifacts. The trainer fails closed until this script has
 * materialized the exact content registered in provenance.json.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

export const SYNTHETIC_GENERATOR_VERSION = 'jotluck-synthetic-short-notes-v1';
export const SYNTHETIC_GENERATOR_SEED = 'project-owned-seed-2026-07-11';
export const GENERATED_CORPUS_RELATIVE_ROOT = 'scripts/corpus/_web-cache/generated-project-owned';
export const SYNTHETIC_LICENSE_ID = 'MIT';
export const SYNTHETIC_OWNER = 'JotLuck project';
export const TARGET_CANONICAL_BYTES = 24 * 1024 * 1024;
export const MAX_PHYSICAL_BYTES = 25 * 1024 * 1024;
export const PACKS_PER_SOURCE = 4;

type SourceLanguage = 'zh' | 'en';
export type FamilyId =
  | 'zh-natural-observation'
  | 'zh-project-progress'
  | 'zh-technical-diagnostic'
  | 'en-workflow-review'
  | 'en-technical-diagnostic';

export interface SyntheticSourcePlan {
  id: string;
  relativeDirectory: string;
  family: FamilyId;
  familyCode: string;
  language: SourceLanguage;
  category: string;
  targetCanonicalBytes: number;
  linesPerDocument: number;
}

export interface GeneratedSyntheticDocument {
  documentId: string;
  sourceId: string;
  family: FamilyId;
  familyCode: string;
  text: string;
  fragments: string[];
  canonicalBytes: number;
  textBytes: number;
  sha256: string;
}

export interface SyntheticJsonlRecord {
  documentId: string;
  text: string;
  family: string;
}

export interface SyntheticPackSummary {
  relativePath: string;
  logicalDocuments: number;
  canonicalBytes: number;
  physicalBytes: number;
  sha256: string;
}

export interface SyntheticSourceSummary {
  id: string;
  relativeDirectory: string;
  family: FamilyId;
  familyCode: string;
  language: SourceLanguage;
  category: string;
  owner: typeof SYNTHETIC_OWNER;
  licenseId: typeof SYNTHETIC_LICENSE_ID;
  targetCanonicalBytes: number;
  canonicalBytes: number;
  shortfallBytes: number;
  physicalBytes: number;
  logicalDocuments: number;
  packCount: number;
  packs: SyntheticPackSummary[];
  contentSha256: string;
  documentIdPattern: string;
}

export interface SyntheticCorpusReport {
  schemaVersion: 1;
  generatorVersion: typeof SYNTHETIC_GENERATOR_VERSION;
  seed: typeof SYNTHETIC_GENERATOR_SEED;
  owner: typeof SYNTHETIC_OWNER;
  licenseId: typeof SYNTHETIC_LICENSE_ID;
  licenseEvidence: '../../../../LICENSE';
  registrationStatus: 'approved-project-owned-input';
  outputRoot: typeof GENERATED_CORPUS_RELATIVE_ROOT;
  targetCanonicalBytes: number;
  totalCanonicalBytes: number;
  totalLogicalDocuments: number;
  totalPacks: number;
  totalPhysicalFiles: number;
  totalPackBytes: number;
  metadataBytes: number;
  totalPhysicalBytes: number;
  corpusSha256: string;
  sources: SyntheticSourceSummary[];
}

export interface SyntheticCorpusFileSystem {
  listFilesRecursive(root: string): string[];
  ensureDirectory(directory: string): void;
  writeUtf8(filePath: string, content: string): void;
}

interface GeneratorDependencies {
  workspaceRoot?: string;
  fileSystem?: SyntheticCorpusFileSystem;
  sourcePlans?: readonly SyntheticSourcePlan[];
  log?: (value: string) => void;
}

interface FamilyVocabulary {
  phases: readonly string[];
  settings: readonly string[];
  subjects: readonly string[];
  actions: readonly string[];
  constraints: readonly string[];
  outcomes: readonly string[];
}

interface SlotValues {
  phase: string;
  setting: string;
  subject: string;
  action: string;
  constraint: string;
  outcome: string;
}

interface FamilyDefinition {
  language: SourceLanguage;
  vocabulary: FamilyVocabulary;
  templates: ReadonlyArray<(slots: SlotValues) => string>;
  supportAnchor: string;
}

const PER_SOURCE_TARGET = Math.floor(TARGET_CANONICAL_BYTES / 5);

export const SYNTHETIC_SOURCE_PLANS: readonly SyntheticSourcePlan[] = [
  {
    id: 'synthetic-natural-zh',
    relativeDirectory: 'synthetic-natural-zh',
    family: 'zh-natural-observation',
    familyCode: 'zn',
    language: 'zh',
    category: 'zh-natural-notes',
    targetCanonicalBytes: PER_SOURCE_TARGET,
    linesPerDocument: 10,
  },
  {
    id: 'synthetic-project-zh',
    relativeDirectory: 'synthetic-project-zh',
    family: 'zh-project-progress',
    familyCode: 'zp',
    language: 'zh',
    category: 'zh-project-notes',
    targetCanonicalBytes: PER_SOURCE_TARGET,
    linesPerDocument: 10,
  },
  {
    id: 'synthetic-technical-zh',
    relativeDirectory: 'synthetic-technical-zh',
    family: 'zh-technical-diagnostic',
    familyCode: 'zt',
    language: 'zh',
    category: 'zh-tech-notes',
    targetCanonicalBytes: PER_SOURCE_TARGET,
    linesPerDocument: 10,
  },
  {
    id: 'synthetic-workflow-en',
    relativeDirectory: 'synthetic-workflow-en',
    family: 'en-workflow-review',
    familyCode: 'ew',
    language: 'en',
    category: 'en-workflow-notes',
    targetCanonicalBytes: PER_SOURCE_TARGET,
    linesPerDocument: 14,
  },
  {
    id: 'synthetic-technical-en',
    relativeDirectory: 'synthetic-technical-en',
    family: 'en-technical-diagnostic',
    familyCode: 'et',
    language: 'en',
    category: 'en-tech-docs',
    targetCanonicalBytes: TARGET_CANONICAL_BYTES - PER_SOURCE_TARGET * 4,
    linesPerDocument: 14,
  },
] as const;

const ZH_PHASES = [
  '清晨开始时',
  '上午整理时',
  '午后复核时',
  '傍晚收尾时',
  '本周第一次检查时',
  '本轮记录开始时',
  '短暂休息以后',
  '重新打开笔记时',
  '完成上一项以后',
  '准备下一轮之前',
  '环境稳定以后',
  '对照旧记录时',
] as const;

const ZH_CONSTRAINTS = [
  '保持其他条件不变',
  '只调整一个因素',
  '先保留原有顺序',
  '不增加额外步骤',
  '继续使用同一标准',
  '暂时不扩大范围',
  '避免同时修改两处',
  '沿用已有检查方法',
  '先不改变时间窗口',
  '把变量限制在一项',
  '维持相同记录粒度',
  '只比较相邻两次结果',
] as const;

const ZH_OUTCOMES = [
  '下一轮能够直接比较变化',
  '复盘时可以找到明确依据',
  '后续调整不会失去参照',
  '异常再次出现时容易定位',
  '记录能够支持下一步判断',
  '结果可以交给下一次验证',
  '差异会在复查时更清楚',
  '决定可以回到原始证据',
  '后续工作不会重复试错',
  '变化范围能够保持可控',
  '结论可以在短时间内复现',
  '下一次记录能延续同一口径',
] as const;

const EN_PHASES = [
  'At the start of the morning review',
  'During the first focused pass',
  'Before the afternoon checkpoint',
  'After the previous item was closed',
  'While preparing the next short review',
  'At the beginning of this work session',
  'When the earlier note was reopened',
  'Before the final check of the day',
  'After a brief pause in the workflow',
  'During the weekly comparison pass',
  'When the surrounding conditions were stable',
  'Before handing the result to the next step',
] as const;

const EN_CONSTRAINTS = [
  'while keeping every other condition unchanged',
  'without adding another moving part',
  'while preserving the existing order of work',
  'with only one variable changed at a time',
  'without widening the scope of the check',
  'while using the same acceptance rule',
  'without mixing a second experiment into the note',
  'while retaining the previous comparison window',
  'with the same level of detail in every entry',
  'without replacing the original reference point',
  'while comparing only adjacent observations',
  'with the current timing window left intact',
] as const;

const EN_OUTCOMES = [
  'so the next pass can compare the change directly',
  'so the review can return to a clear piece of evidence',
  'so a repeated issue will be easier to locate',
  'so the following decision keeps a stable reference point',
  'so the result can be checked again without guesswork',
  'so the next note can continue with the same measurement rule',
  'so later adjustments do not erase the useful baseline',
  'so the difference remains visible during the next review',
  'so the conclusion can be reproduced in a short session',
  'so the handoff includes a concrete reason for the decision',
  'so the team does not repeat the same trial unnecessarily',
  'so the remaining uncertainty is recorded rather than hidden',
] as const;

const FAMILY_DEFINITIONS: Record<FamilyId, FamilyDefinition> = {
  'zh-natural-observation': {
    language: 'zh',
    supportAnchor: '今天记录',
    vocabulary: {
      phases: ZH_PHASES,
      settings: [
        '窗边的光线下',
        '安静的书桌旁',
        '小区步道一侧',
        '厨房通风以后',
        '阳台植物旁边',
        '雨后路面附近',
        '傍晚房间里面',
        '整理好的柜子前',
        '晨间散步途中',
        '午后阅读角落',
        '收拾完成的桌面上',
        '温度平稳的室内',
      ],
      subjects: [
        '叶片舒展的程度',
        '房间光线的变化',
        '面团表面的细小气孔',
        '步行以后呼吸的节奏',
        '茶水冷却的速度',
        '窗锁开合的手感',
        '纸张边缘的纹理',
        '收纳位置的便利程度',
        '雨声变缓的时间',
        '阅读时注意力的波动',
        '午后风向的改变',
        '清理以后桌面的使用感受',
      ],
      actions: [
        '记录最明显的变化',
        '补充一条简短对照',
        '把观察写成两句摘要',
        '标出需要继续留意的细节',
        '比较前后两次状态',
        '写下当时的环境条件',
        '保留一项可复查的线索',
        '把主观感受和事实分开',
        '确认变化是否持续',
        '整理成下一次观察清单',
        '删去没有依据的猜测',
        '把未确认部分单独留下',
      ],
      constraints: ZH_CONSTRAINTS,
      outcomes: ZH_OUTCOMES,
    },
    templates: [
      (s) =>
        `今天记录${s.subject}：${s.phase}，我在${s.setting}${s.action}，${s.constraint}，这样${s.outcome}。`,
      (s) =>
        `${s.phase}，我留意${s.setting}的${s.subject}，随后${s.action}，${s.constraint}，确保${s.outcome}。`,
      (s) =>
        `这次关于${s.subject}的短记发生在${s.setting}，${s.phase}先${s.action}，并且${s.constraint}，让${s.outcome}。`,
      (s) =>
        `观察${s.subject}时，我选择${s.setting}作为参照，${s.phase}${s.action}，${s.constraint}，之后${s.outcome}。`,
      (s) =>
        `${s.setting}的日常记录聚焦${s.subject}，${s.phase}我先${s.action}，同时${s.constraint}，希望${s.outcome}。`,
      (s) =>
        `为了看清${s.subject}，${s.phase}我在${s.setting}${s.action}，这次${s.constraint}，因此${s.outcome}。`,
    ],
  },
  'zh-project-progress': {
    language: 'zh',
    supportAnchor: '本轮先完成',
    vocabulary: {
      phases: ZH_PHASES,
      settings: [
        '需求梳理阶段',
        '任务拆分清单',
        '进度同步笔记',
        '评审准备环节',
        '风险复查列表',
        '交付前检查表',
        '迭代回顾页面',
        '协作交接记录',
        '本周优先级列表',
        '验收证据目录',
        '范围变更摘要',
        '下一轮计划草稿',
      ],
      subjects: [
        '目标边界',
        '关键依赖',
        '验收条件',
        '阻塞事项',
        '任务顺序',
        '风险假设',
        '交付证据',
        '协作接口',
        '剩余工作量',
        '反馈处理方式',
        '变更影响范围',
        '下一步负责人范围',
      ],
      actions: [
        '补齐缺少的事实',
        '拆成可以验证的小项',
        '确认当前完成状态',
        '标明依赖和停止点',
        '把风险写成可观察结果',
        '整理已有证据',
        '删除重复的任务描述',
        '更新交接所需上下文',
        '核对范围是否发生漂移',
        '为下一次评审准备问题',
        '把模糊动作改成明确步骤',
        '确认剩余事项的先后关系',
      ],
      constraints: ZH_CONSTRAINTS,
      outcomes: ZH_OUTCOMES,
    },
    templates: [
      (s) =>
        `本轮先完成${s.subject}的核对：${s.phase}在${s.setting}${s.action}，${s.constraint}，从而${s.outcome}。`,
      (s) =>
        `${s.setting}目前围绕${s.subject}推进，${s.phase}先${s.action}，${s.constraint}，保证${s.outcome}。`,
      (s) =>
        `项目短记聚焦${s.subject}，我在${s.setting}${s.action}，${s.phase}${s.constraint}，使${s.outcome}。`,
      (s) =>
        `处理${s.subject}时，${s.phase}先查看${s.setting}并${s.action}，${s.constraint}，这样${s.outcome}。`,
      (s) =>
        `${s.phase}的进度记录显示，${s.setting}需要针对${s.subject}${s.action}，同时${s.constraint}，以便${s.outcome}。`,
      (s) =>
        `为了推进${s.subject}，我从${s.setting}开始${s.action}，${s.phase}${s.constraint}，最终${s.outcome}。`,
    ],
  },
  'zh-technical-diagnostic': {
    language: 'zh',
    supportAnchor: '排查问题时',
    vocabulary: {
      phases: ZH_PHASES,
      settings: [
        '输入处理路径',
        '本地缓存边界',
        '文件读取流程',
        '状态同步链路',
        '渲染更新阶段',
        '配置加载入口',
        '后台任务队列',
        '错误恢复分支',
        '序列化过程',
        '增量更新流程',
        '离线启动路径',
        '资源释放阶段',
      ],
      subjects: [
        '重复写入现象',
        '过期状态回流',
        '路径解析偏差',
        '计时任务覆盖',
        '缓存内容损坏',
        '边界条件漏判',
        '异步结果迟到',
        '计数异常增长',
        '格式识别偏差',
        '资源没有释放',
        '离线回退失效',
        '多次初始化竞争',
      ],
      actions: [
        '复现最小失败路径',
        '比较前后状态快照',
        '记录每一步输入输出',
        '确认第一个异常位置',
        '加入单一变量对照',
        '核对错误分支是否可见',
        '检查旧任务是否取消',
        '验证损坏数据能否降级',
        '追踪计数的真实来源',
        '测量关键步骤耗时',
        '确认资源释放顺序',
        '为边界条件补充断言',
      ],
      constraints: ZH_CONSTRAINTS,
      outcomes: ZH_OUTCOMES,
    },
    templates: [
      (s) =>
        `排查问题时先看${s.subject}：${s.phase}在${s.setting}${s.action}，${s.constraint}，确保${s.outcome}。`,
      (s) =>
        `${s.setting}出现${s.subject}以后，${s.phase}我先${s.action}，${s.constraint}，这样${s.outcome}。`,
      (s) =>
        `技术记录聚焦${s.subject}，${s.phase}针对${s.setting}${s.action}，并且${s.constraint}，让${s.outcome}。`,
      (s) =>
        `为了定位${s.subject}，我在${s.setting}${s.action}，${s.phase}${s.constraint}，从而${s.outcome}。`,
      (s) =>
        `${s.phase}的诊断笔记从${s.setting}开始，围绕${s.subject}${s.action}，${s.constraint}，以便${s.outcome}。`,
      (s) =>
        `检查${s.setting}时发现需要关注${s.subject}，于是${s.phase}${s.action}，${s.constraint}，最终${s.outcome}。`,
    ],
  },
  'en-workflow-review': {
    language: 'en',
    supportAnchor: 'The workflow note',
    vocabulary: {
      phases: EN_PHASES,
      settings: [
        'planning checklist',
        'meeting follow-up',
        'weekly review page',
        'handoff summary',
        'task sequence',
        'decision log',
        'risk review',
        'delivery checklist',
        'reading queue',
        'feedback summary',
        'priority list',
        'next-session outline',
      ],
      subjects: [
        'current objective',
        'remaining dependency',
        'acceptance condition',
        'open question',
        'next practical action',
        'working assumption',
        'handoff evidence',
        'review boundary',
        'unfinished task',
        'decision rationale',
        'scope adjustment',
        'follow-up checkpoint',
      ],
      actions: [
        'turned the vague item into a checkable action',
        'recorded the evidence already available',
        'separated the dependency from the desired outcome',
        'marked the exact point where work should stop',
        'removed a repeated task description',
        'rewrote the question in observable terms',
        'placed the remaining work in a clear order',
        'captured the reason behind the latest choice',
        'noted which assumption still needs a test',
        'prepared a concise handoff for the next session',
        'checked whether the scope had drifted',
        'linked the next action to a concrete result',
      ],
      constraints: EN_CONSTRAINTS,
      outcomes: EN_OUTCOMES,
    },
    templates: [
      (s) =>
        `The workflow note focuses on the ${s.subject} — ${s.phase}, the ${s.setting} ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `${s.phase}, the ${s.setting} reviewed the ${s.subject} and ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `This short work note uses the ${s.setting} to clarify the ${s.subject}, and ${s.phase}, it ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `For the ${s.subject}, the ${s.setting} ${s.action}, and ${s.phase}, it did so ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `The ${s.setting} keeps the ${s.subject} visible, and ${s.phase}, it ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `To move the ${s.subject} forward, the ${s.setting} ${s.action}, and ${s.phase}, it worked ${s.constraint}, ${s.outcome}.`,
    ],
  },
  'en-technical-diagnostic': {
    language: 'en',
    supportAnchor: 'The diagnostic note',
    vocabulary: {
      phases: EN_PHASES,
      settings: [
        'input processing path',
        'local cache boundary',
        'file loading sequence',
        'state synchronization path',
        'render update cycle',
        'configuration entry point',
        'background task queue',
        'error recovery branch',
        'serialization step',
        'incremental update path',
        'offline startup route',
        'resource cleanup phase',
      ],
      subjects: [
        'repeated write',
        'stale state return',
        'path resolution mismatch',
        'timer replacement',
        'damaged cache entry',
        'missing boundary check',
        'late asynchronous result',
        'unexpected count increase',
        'format detection mismatch',
        'unreleased resource',
        'offline fallback failure',
        'competing initialization',
      ],
      actions: [
        'reproduced the smallest failing path',
        'compared the state before and after the update',
        'recorded the input and output of each step',
        'located the first observable divergence',
        'introduced a single-variable comparison',
        'checked whether the failure branch remained visible',
        'verified that the older task was cancelled',
        'tested the fallback with a damaged value',
        'traced the count back to its original contribution',
        'measured the duration of the critical step',
        'confirmed the order of resource cleanup',
        'added an assertion for the boundary condition',
      ],
      constraints: EN_CONSTRAINTS,
      outcomes: EN_OUTCOMES,
    },
    templates: [
      (s) =>
        `The diagnostic note examines the ${s.subject} — ${s.phase}, the ${s.setting} ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `${s.phase}, the ${s.setting} showed a ${s.subject}, so the check ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `This technical note tracks the ${s.subject} through the ${s.setting}, and ${s.phase}, it ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `To isolate the ${s.subject}, the ${s.setting} ${s.action}, and ${s.phase}, the check continued ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `The ${s.setting} review keeps the ${s.subject} observable, and ${s.phase}, it ${s.action}, ${s.constraint}, ${s.outcome}.`,
      (s) =>
        `While checking the ${s.setting}, the note found the ${s.subject}, then ${s.phase}, it ${s.action}, ${s.constraint}, ${s.outcome}.`,
    ],
  },
};

export function generateSyntheticDocument(
  plan: SyntheticSourcePlan,
  zeroBasedDocumentIndex: number,
): GeneratedSyntheticDocument {
  validateSourcePlan(plan);
  if (!Number.isSafeInteger(zeroBasedDocumentIndex) || zeroBasedDocumentIndex < 0) {
    throw new Error('Document index must be a non-negative safe integer.');
  }
  const definition = FAMILY_DEFINITIONS[plan.family];
  const fragments: string[] = [];
  for (let lineIndex = 0; lineIndex < plan.linesPerDocument; lineIndex++) {
    const ordinal = zeroBasedDocumentIndex * plan.linesPerDocument + lineIndex;
    const slots = selectSlots(definition.vocabulary, plan.family, ordinal);
    const template = definition.templates[ordinal % definition.templates.length]!;
    fragments.push(template(slots));
  }
  const documentId = `${plan.familyCode}${(zeroBasedDocumentIndex + 1)
    .toString(36)
    .padStart(4, '0')}`;
  const text = fragments.join(' ');
  return {
    documentId,
    sourceId: plan.id,
    family: plan.family,
    familyCode: plan.familyCode,
    text,
    fragments,
    canonicalBytes: fragments.reduce((sum, fragment) => sum + utf8Bytes(fragment), 0),
    textBytes: utf8Bytes(text),
    sha256: sha256(text),
  };
}

export function serializeSyntheticJsonlRecord(document: GeneratedSyntheticDocument): string {
  if (/[\r\n]/u.test(document.text)) {
    throw new Error(`Synthetic JSONL text must stay on one line: ${document.documentId}.`);
  }
  const record: SyntheticJsonlRecord = {
    documentId: document.documentId,
    text: document.text,
    family: document.familyCode,
  };
  return JSON.stringify(record);
}

export function buildSyntheticCorpusReport(
  plans: readonly SyntheticSourcePlan[] = SYNTHETIC_SOURCE_PLANS,
): SyntheticCorpusReport {
  validatePlans(plans);
  const sources = plans.map(summarizeSource);
  const totalCanonicalBytes = sources.reduce((sum, source) => sum + source.canonicalBytes, 0);
  const totalLogicalDocuments = sources.reduce((sum, source) => sum + source.logicalDocuments, 0);
  const totalPacks = sources.reduce((sum, source) => sum + source.packCount, 0);
  const totalPackBytes = sources.reduce((sum, source) => sum + source.physicalBytes, 0);
  const metadata = serializeMetadata(
    sources,
    totalCanonicalBytes,
    totalLogicalDocuments,
    totalPacks,
    totalPackBytes,
  );
  const metadataBytes = utf8Bytes(metadata);
  const totalPhysicalFiles = totalPacks + 1;
  const totalPhysicalBytes = totalPackBytes + metadataBytes;
  if (totalPhysicalBytes > MAX_PHYSICAL_BYTES && plans === SYNTHETIC_SOURCE_PLANS) {
    throw new Error(
      `Synthetic corpus physical size ${totalPhysicalBytes} exceeds ${MAX_PHYSICAL_BYTES}.`,
    );
  }
  return {
    schemaVersion: 1,
    generatorVersion: SYNTHETIC_GENERATOR_VERSION,
    seed: SYNTHETIC_GENERATOR_SEED,
    owner: SYNTHETIC_OWNER,
    licenseId: SYNTHETIC_LICENSE_ID,
    licenseEvidence: '../../../../LICENSE',
    registrationStatus: 'approved-project-owned-input',
    outputRoot: GENERATED_CORPUS_RELATIVE_ROOT,
    targetCanonicalBytes: plans.reduce((sum, plan) => sum + plan.targetCanonicalBytes, 0),
    totalCanonicalBytes,
    totalLogicalDocuments,
    totalPacks,
    totalPhysicalFiles,
    totalPackBytes,
    metadataBytes,
    totalPhysicalBytes,
    corpusSha256: sha256(metadata),
    sources,
  };
}

export function resolveGeneratedCorpusRoot(
  workspaceRoot: string,
  requestedOutput = GENERATED_CORPUS_RELATIVE_ROOT,
): string {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const allowedRoot = path.resolve(resolvedWorkspace, GENERATED_CORPUS_RELATIVE_ROOT);
  const requestedRoot = path.isAbsolute(requestedOutput)
    ? path.resolve(requestedOutput)
    : path.resolve(resolvedWorkspace, requestedOutput);
  if (normalizePathForComparison(requestedRoot) !== normalizePathForComparison(allowedRoot)) {
    throw new Error(`Synthetic corpus output must be exactly ${GENERATED_CORPUS_RELATIVE_ROOT}.`);
  }
  assertPathInside(requestedRoot, resolvedWorkspace);
  return requestedRoot;
}

export function writeSyntheticCorpus(
  root: string,
  report: SyntheticCorpusReport,
  fileSystem: SyntheticCorpusFileSystem,
  plans: readonly SyntheticSourcePlan[] = SYNTHETIC_SOURCE_PLANS,
): void {
  const expectedReport = buildSyntheticCorpusReport(plans);
  if (JSON.stringify(report) !== JSON.stringify(expectedReport)) {
    throw new Error('Synthetic corpus report does not match the declared source plans.');
  }
  const expectedFiles = buildExpectedFileSet(root, report);
  const existingFiles = fileSystem.listFilesRecursive(root);
  for (const existingFile of existingFiles) {
    const resolved = path.resolve(existingFile);
    assertPathInside(resolved, root);
    if (!expectedFiles.has(normalizePathForComparison(resolved))) {
      throw new Error(`Unknown file blocks synthetic corpus generation: ${existingFile}`);
    }
  }

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const packedOutputs = new Map<string, string>();
  for (const source of report.sources) {
    const plan = planById.get(source.id);
    if (!plan) throw new Error(`Missing declared source plan for ${source.id}.`);
    const packContents = materializeSourcePacks(plan, source.logicalDocuments, source.packCount);
    for (let packIndex = 0; packIndex < source.packCount; packIndex++) {
      const summary = source.packs[packIndex]!;
      const content = packContents[packIndex]!;
      if (utf8Bytes(content) !== summary.physicalBytes || sha256(content) !== summary.sha256) {
        throw new Error(`Synthetic pack does not match its report: ${summary.relativePath}.`);
      }
      packedOutputs.set(summary.relativePath, content);
    }
  }

  const metadata = serializeMetadata(
    report.sources,
    report.totalCanonicalBytes,
    report.totalLogicalDocuments,
    report.totalPacks,
    report.totalPackBytes,
  );
  if (utf8Bytes(metadata) !== report.metadataBytes || sha256(metadata) !== report.corpusSha256) {
    throw new Error('Synthetic corpus metadata does not match its report.');
  }

  fileSystem.ensureDirectory(root);
  for (const [relativePath, content] of packedOutputs) {
    const target = resolveDeclaredTarget(root, relativePath);
    fileSystem.ensureDirectory(path.dirname(target));
    fileSystem.writeUtf8(target, content);
  }
  const metadataPath = resolveDeclaredTarget(root, '_metadata.json');
  fileSystem.writeUtf8(metadataPath, metadata);
}

export function runSyntheticCorpusGenerator(
  argv: string[] = process.argv.slice(2),
  dependencies: GeneratorDependencies = {},
): SyntheticCorpusReport {
  const options = parseCli(argv);
  const workspaceRoot = dependencies.workspaceRoot ?? process.cwd();
  const outputRoot = resolveGeneratedCorpusRoot(workspaceRoot, options.outputDirectory);
  const plans = dependencies.sourcePlans ?? SYNTHETIC_SOURCE_PLANS;
  const report = buildSyntheticCorpusReport(plans);
  const log = dependencies.log ?? console.log;
  if (options.dryRun) {
    log(JSON.stringify(report, null, 2));
    return report;
  }
  const fileSystem = dependencies.fileSystem ?? NODE_FILE_SYSTEM;
  writeSyntheticCorpus(outputRoot, report, fileSystem, plans);
  log(JSON.stringify(report, null, 2));
  return report;
}

export function familySupportAnchor(family: FamilyId): string {
  return FAMILY_DEFINITIONS[family].supportAnchor;
}

function summarizeSource(plan: SyntheticSourcePlan): SyntheticSourceSummary {
  let canonicalBytes = 0;
  let logicalDocuments = 0;
  while (logicalDocuments < 100_000) {
    const document = generateSyntheticDocument(plan, logicalDocuments);
    if (canonicalBytes + document.canonicalBytes > plan.targetCanonicalBytes) break;
    canonicalBytes += document.canonicalBytes;
    logicalDocuments++;
  }
  if (logicalDocuments === 0) throw new Error(`${plan.id} target is too small for one document.`);
  const packCount = Math.min(PACKS_PER_SOURCE, logicalDocuments);
  const packStates = Array.from({ length: packCount }, (_, packIndex) => ({
    relativePath: packRelativePath(plan, packIndex),
    logicalDocuments: 0,
    canonicalBytes: 0,
    physicalBytes: 0,
    hash: crypto.createHash('sha256'),
  }));
  for (let index = 0; index < logicalDocuments; index++) {
    const document = generateSyntheticDocument(plan, index);
    const line = `${serializeSyntheticJsonlRecord(document)}\n`;
    const state = packStates[packIndexForDocument(index, logicalDocuments, packCount)]!;
    state.logicalDocuments++;
    state.canonicalBytes += document.canonicalBytes;
    state.physicalBytes += utf8Bytes(line);
    state.hash.update(line, 'utf8');
  }
  const packs: SyntheticPackSummary[] = packStates.map((state) => ({
    relativePath: state.relativePath,
    logicalDocuments: state.logicalDocuments,
    canonicalBytes: state.canonicalBytes,
    physicalBytes: state.physicalBytes,
    sha256: state.hash.digest('hex'),
  }));
  const physicalBytes = packs.reduce((sum, pack) => sum + pack.physicalBytes, 0);
  // Keep this byte-for-byte compatible with train-baseline.ts/hashSourceFiles.
  // The logical document count remains in the generated metadata, while the
  // approved source identity is derived solely from relative file paths and
  // their content hashes.
  const contentSha256 = sha256(
    JSON.stringify(
      packs.map((pack) => ({
        path: path.posix.basename(pack.relativePath),
        sha256: pack.sha256,
      })),
    ),
  );
  return {
    id: plan.id,
    relativeDirectory: plan.relativeDirectory,
    family: plan.family,
    familyCode: plan.familyCode,
    language: plan.language,
    category: plan.category,
    owner: SYNTHETIC_OWNER,
    licenseId: SYNTHETIC_LICENSE_ID,
    targetCanonicalBytes: plan.targetCanonicalBytes,
    canonicalBytes,
    shortfallBytes: plan.targetCanonicalBytes - canonicalBytes,
    physicalBytes,
    logicalDocuments,
    packCount,
    packs,
    contentSha256,
    documentIdPattern: `${plan.familyCode}NNNN (base36)`,
  };
}

function materializeSourcePacks(
  plan: SyntheticSourcePlan,
  logicalDocuments: number,
  packCount: number,
): string[] {
  const lines = Array.from({ length: packCount }, () => [] as string[]);
  for (let index = 0; index < logicalDocuments; index++) {
    const document = generateSyntheticDocument(plan, index);
    const packIndex = packIndexForDocument(index, logicalDocuments, packCount);
    lines[packIndex]!.push(serializeSyntheticJsonlRecord(document));
  }
  return lines.map((packLines) => `${packLines.join('\n')}\n`);
}

function packIndexForDocument(
  zeroBasedDocumentIndex: number,
  logicalDocuments: number,
  packCount: number,
): number {
  if (packCount < 1 || packCount > PACKS_PER_SOURCE || packCount > logicalDocuments) {
    throw new Error(`Invalid synthetic pack count: ${packCount}.`);
  }
  return Math.min(
    packCount - 1,
    Math.floor((zeroBasedDocumentIndex * packCount) / logicalDocuments),
  );
}

function packRelativePath(plan: SyntheticSourcePlan, zeroBasedPackIndex: number): string {
  return `${plan.relativeDirectory}/pack-${String(zeroBasedPackIndex + 1).padStart(2, '0')}.jsonl`;
}

function selectSlots(vocabulary: FamilyVocabulary, family: FamilyId, ordinal: number): SlotValues {
  const arrays = [
    vocabulary.phases,
    vocabulary.settings,
    vocabulary.subjects,
    vocabulary.actions,
    vocabulary.constraints,
    vocabulary.outcomes,
  ] as const;
  const capacity = arrays.reduce((product, values) => product * values.length, 1);
  const seedOffset = hashToSafeInteger(`${SYNTHETIC_GENERATOR_SEED}\0${family}`) % 1_000_000;
  let encoded = seedOffset + ordinal;
  if (encoded >= capacity) {
    throw new Error(`${family} exhausted its deterministic vocabulary combinations.`);
  }
  const selected: string[] = [];
  for (const values of arrays) {
    selected.push(values[encoded % values.length]!);
    encoded = Math.floor(encoded / values.length);
  }
  return {
    phase: selected[0]!,
    setting: selected[1]!,
    subject: selected[2]!,
    action: selected[3]!,
    constraint: selected[4]!,
    outcome: selected[5]!,
  };
}

function validatePlans(plans: readonly SyntheticSourcePlan[]): void {
  if (plans.length === 0) throw new Error('At least one synthetic source plan is required.');
  const ids = new Set<string>();
  const directories = new Set<string>();
  const familyCodes = new Set<string>();
  for (const plan of plans) {
    validateSourcePlan(plan);
    if (ids.has(plan.id)) throw new Error(`Duplicate synthetic source id: ${plan.id}.`);
    if (directories.has(plan.relativeDirectory)) {
      throw new Error(`Duplicate synthetic source directory: ${plan.relativeDirectory}.`);
    }
    if (familyCodes.has(plan.familyCode)) {
      throw new Error(`Duplicate synthetic family code: ${plan.familyCode}.`);
    }
    ids.add(plan.id);
    directories.add(plan.relativeDirectory);
    familyCodes.add(plan.familyCode);
  }
}

function validateSourcePlan(plan: SyntheticSourcePlan): void {
  const definition = FAMILY_DEFINITIONS[plan.family];
  if (!definition) throw new Error(`Unknown synthetic family: ${String(plan.family)}.`);
  if (definition.language !== plan.language) {
    throw new Error(`${plan.id} language does not match family ${plan.family}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(plan.id)) {
    throw new Error(`Invalid synthetic source id: ${plan.id}.`);
  }
  if (!/^[a-z]{2}$/u.test(plan.familyCode)) {
    throw new Error(`${plan.id} familyCode must contain exactly two lowercase letters.`);
  }
  if (plan.relativeDirectory !== plan.id) {
    throw new Error(`${plan.id} must use its source id as the fixed directory name.`);
  }
  if (!Number.isSafeInteger(plan.targetCanonicalBytes) || plan.targetCanonicalBytes <= 0) {
    throw new Error(`${plan.id} targetCanonicalBytes must be a positive safe integer.`);
  }
  if (!Number.isSafeInteger(plan.linesPerDocument) || plan.linesPerDocument < 2) {
    throw new Error(`${plan.id} linesPerDocument must be an integer of at least two.`);
  }
}

function buildExpectedFileSet(root: string, report: SyntheticCorpusReport): Set<string> {
  const expected = new Set<string>();
  expected.add(normalizePathForComparison(resolveDeclaredTarget(root, '_metadata.json')));
  for (const source of report.sources) {
    if (
      source.packCount < 1 ||
      source.packCount > PACKS_PER_SOURCE ||
      source.packCount !== source.packs.length
    ) {
      throw new Error(`${source.id} declares an invalid pack count.`);
    }
    for (let index = 0; index < source.packCount; index++) {
      const pack = source.packs[index]!;
      const expectedRelativePath = `${source.relativeDirectory}/pack-${String(index + 1).padStart(
        2,
        '0',
      )}.jsonl`;
      if (pack.relativePath !== expectedRelativePath) {
        throw new Error(`${source.id} declares an unexpected pack path: ${pack.relativePath}.`);
      }
      const resolved = normalizePathForComparison(resolveDeclaredTarget(root, pack.relativePath));
      if (expected.has(resolved)) {
        throw new Error(`Duplicate synthetic corpus target: ${pack.relativePath}.`);
      }
      expected.add(resolved);
    }
  }
  if (expected.size !== report.totalPhysicalFiles) {
    throw new Error('Synthetic corpus physical file count does not match its report.');
  }
  return expected;
}

function serializeMetadata(
  sources: SyntheticSourceSummary[],
  totalCanonicalBytes: number,
  totalLogicalDocuments: number,
  totalPacks: number,
  totalPackBytes: number,
): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      generatorVersion: SYNTHETIC_GENERATOR_VERSION,
      seed: SYNTHETIC_GENERATOR_SEED,
      owner: SYNTHETIC_OWNER,
      licenseId: SYNTHETIC_LICENSE_ID,
      licenseEvidence: '../../../../LICENSE',
      registrationStatus: 'approved-project-owned-input',
      notice: 'Project-owned synthetic short notes registered by deterministic content hash.',
      totalCanonicalBytes,
      totalLogicalDocuments,
      totalPacks,
      totalPackBytes,
      sources,
    },
    null,
    2,
  )}\n`;
}

function resolveDeclaredTarget(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath))
    throw new Error(`Declared target must be relative: ${relativePath}`);
  const target = path.resolve(root, relativePath);
  assertPathInside(target, root);
  return target;
}

function assertPathInside(candidate: string, root: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Synthetic corpus path escapes its root: ${candidate}`);
  }
}

function normalizePathForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/\\/gu, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function parseCli(argv: string[]): { dryRun: boolean; outputDirectory: string } {
  const allowed = new Set(['--dry-run', '--output-dir']);
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]!;
    const name = item.includes('=') ? item.slice(0, item.indexOf('=')) : item;
    if (!allowed.has(name)) throw new Error(`Unsupported synthetic corpus option: ${item}`);
    if (name === '--dry-run' && item !== '--dry-run') {
      throw new Error('--dry-run does not accept a value.');
    }
    if (name === '--output-dir' && !item.includes('=')) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output-dir requires a path.');
      index++;
    }
  }
  const outputDirectory = readArg(argv, '--output-dir') ?? GENERATED_CORPUS_RELATIVE_ROOT;
  if (!outputDirectory || outputDirectory.startsWith('--')) {
    throw new Error('--output-dir requires a path.');
  }
  return { dryRun: argv.includes('--dry-run'), outputDirectory };
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hashToSafeInteger(value: string): number {
  const digest = crypto.createHash('sha256').update(value).digest();
  return digest.readUInt32BE(0);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

const NODE_FILE_SYSTEM: SyntheticCorpusFileSystem = {
  listFilesRecursive(root) {
    if (!fs.existsSync(root)) return [];
    if (fs.lstatSync(root).isSymbolicLink()) {
      throw new Error(`Synthetic corpus root must not be a symbolic link: ${root}`);
    }
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error(`Symbolic links are not allowed in the synthetic corpus root: ${target}`);
        }
        if (entry.isDirectory()) walk(target);
        else if (entry.isFile()) files.push(target);
        else throw new Error(`Unsupported filesystem entry in synthetic corpus root: ${target}`);
      }
    };
    walk(root);
    return files.sort((a, b) => a.localeCompare(b, 'en'));
  },
  ensureDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
  },
  writeUtf8(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf8');
  },
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runSyntheticCorpusGenerator();
}
