import * as path from 'node:path';
import { canonicalSha256, sha256 } from './common';
import {
  type V2RCorpusCandidate,
  type V2RCorpusSource,
  type V2RNoteCategory,
} from './corpus-governance';
import type { V2RLanguage } from './phrase-extraction';
import { V2R_CACHE_RELATIVE_ROOT, V2R_REPOSITORY_ROOT, resolveV2RCacheRoot } from './workspace';

export const PROJECT_OWNED_GENERATOR_V3 = 'jotluck-project-owned-short-notes-v3.1';
export const PROJECT_OWNED_GENERATOR_V3_SEED = 'v2r-project-owned-2026-07-12-b';
export const PROJECT_OWNED_V3_RELATIVE_ROOT = `${V2R_CACHE_RELATIVE_ROOT}/generated-project-owned-v3.1`;
// External CC0 sources are optional. The project-owned generator must be able
// to fill the complete 30 MiB pool when an approved external cache is absent.
export const PROJECT_OWNED_TARGET_BYTES = 30 * 1024 * 1024;

export interface ProjectOwnedSourcePlanV3 {
  id: string;
  language: V2RLanguage;
  category: V2RNoteCategory;
  relativeDirectory: string;
  targetBytes: number;
}

export interface GeneratedProjectOwnedDocumentV3 extends V2RCorpusCandidate {
  generatorVersion: typeof PROJECT_OWNED_GENERATOR_V3;
  generatorSeed: string;
  templateId: string;
  bytes: number;
  sha256: string;
}

const CATEGORIES: readonly V2RNoteCategory[] = [
  'field-observation',
  'maintenance-log',
  'meeting-note',
  'reading-note',
  'household-plan',
] as const;

const PER_SOURCE_TARGET = Math.floor(PROJECT_OWNED_TARGET_BYTES / 10);

export const PROJECT_OWNED_SOURCE_PLANS_V3: readonly ProjectOwnedSourcePlanV3[] = (
  ['zh', 'en'] as const
).flatMap((language) =>
  CATEGORIES.map((category, index) => ({
    id: `project-v3-${language}-${category}`,
    language,
    category,
    relativeDirectory: `${PROJECT_OWNED_V3_RELATIVE_ROOT}/${language}/${category}`,
    targetBytes:
      language === 'en' && index === CATEGORIES.length - 1
        ? PROJECT_OWNED_TARGET_BYTES - PER_SOURCE_TARGET * 9
        : PER_SOURCE_TARGET,
  })),
);

interface Lexicon {
  subjects: readonly string[];
  settings: readonly string[];
  observations: readonly string[];
  actions: readonly string[];
  outcomes: readonly string[];
}

const ZH_COMPARISON_DETAILS = [
  '对照条件在记录期间保持不变',
  '本次只改变了一个可观察变量',
  '相邻区域被保留为独立参照',
  '记录没有加入未经确认的推测',
  '复核使用了与前次相同的顺序',
  '变化前后的时间点已经分开标注',
  '现场状态在处理前先完成留档',
  '结论只覆盖这次实际检查的范围',
  '后续动作被限制为一个最小步骤',
  '不确定部分仍以问题形式保留',
  '原始现象和处理结果分别记录',
  '下一次检查可以复用相同参照',
  '当前判断不依赖额外外部资料',
  '异常与日常波动已经分别描述',
  '记录同时注明了尚未验证的条件',
  '停止条件在开始处理前已经明确',
] as const;

const EN_COMPARISON_DETAILS = [
  'the comparison conditions stayed unchanged during the note',
  'only one observable variable changed in this pass',
  'a neighboring area remained available as a separate reference',
  'the record avoided assumptions that had not been checked',
  'the review followed the same order as the previous pass',
  'the moments before and after the change were marked separately',
  'the initial state was recorded before any adjustment',
  'the conclusion covers only the area that was actually checked',
  'the follow-up was limited to one small action',
  'uncertain details remain written as open questions',
  'the original symptom and the result were recorded separately',
  'the next check can reuse the same reference point',
  'the current judgment does not depend on outside material',
  'ordinary variation and the unusual result were described apart',
  'the note identifies the conditions that remain unverified',
  'the stopping condition was clear before the work began',
] as const;

const ZH_SUMMARY_NOUNS = [
  '现场记录',
  '复核笔记',
  '工作日志',
  '跟进条目',
  '对照记录',
  '观察笔记',
  '状态条目',
  '检查摘要',
] as const;
const ZH_SUMMARY_ADVERBS = [
  '清楚地',
  '目前',
  '初步',
  '一致地',
  '直接',
  '暂时',
  '可靠地',
  '在当前范围内',
] as const;
const ZH_SUMMARY_VERBS = [
  '说明',
  '显示',
  '支持',
  '确认',
  '表明',
  '记录了',
  '建立了以下判断',
  '给出了同一结论',
] as const;

const EN_SUMMARY_NOUNS = [
  'field record',
  'review note',
  'working log',
  'follow-up entry',
  'comparison record',
  'observation note',
  'status entry',
  'check summary',
] as const;
const EN_SUMMARY_ADVERBS = [
  'clearly',
  'currently',
  'tentatively',
  'consistently',
  'directly',
  'provisionally',
  'reliably',
  'within the current scope',
] as const;
const EN_SUMMARY_VERBS = [
  'indicates',
  'shows',
  'supports the conclusion',
  'confirms',
  'suggests',
  'records',
  'establishes',
  'demonstrates',
] as const;

// Cross-category vocabulary deliberately produces natural, short note clauses
// beyond the category templates. It is project-owned and does not contain any
// frozen holdout continuation. The combinatorial surface gives the fixed
// phrase library broad Chinese 3-gram and English full-word coverage.
const ZH_VARIATION_ADVERBS = [
  '随后',
  '目前',
  '同时',
  '最后',
  '接着',
  '再次',
  '逐项',
  '分别',
  '及时',
  '直接',
  '初步',
  '完整地',
  '按顺序',
  '在现场',
  '在复核时',
  '在收尾前',
  '稍后',
  '当场',
  '按计划',
  '在确认后',
  '在交接前',
  '从头开始',
  '在下一轮',
  '在整理期间',
  '经过比较',
  '在记录末尾',
  '按照清单',
  '在限定范围内',
  '在重新检查时',
  '在准备完成后',
  '在条件稳定时',
  '在结果明确后',
] as const;
const ZH_VARIATION_ACTORS = [
  '记录者',
  '负责人',
  '观察者',
  '维护人员',
  '参与者',
  '整理人',
  '复核人员',
  '值班人员',
  '读者',
  '家庭成员',
  '执行人',
  '检查人员',
  '同事',
  '管理员',
  '使用者',
  '计划负责人',
  '协调人',
  '当班同伴',
  '笔记整理者',
  '现场协作者',
  '任务所有者',
  '资料维护者',
  '本轮参与人',
  '清单编写者',
  '流程观察员',
  '交接接收人',
  '事项联系人',
  '测试执行者',
  '日志维护人',
  '阅读记录者',
  '计划协调者',
  '结果确认者',
] as const;
const ZH_VARIATION_ACTIONS = [
  '核对了',
  '记录了',
  '检查了',
  '整理了',
  '调整了',
  '确认了',
  '比较了',
  '保留了',
  '更新了',
  '标注了',
  '移除了',
  '补充了',
  '复核了',
  '测量了',
  '归纳了',
  '安排了',
  '跟进了',
  '验证了',
  '清理了',
  '汇总了',
  '拆分了',
  '合并了',
  '观察了',
  '测试了',
  '校准了',
  '筛选了',
  '排列了',
  '重写了',
  '归档了',
  '圈定了',
  '列出了',
  '追踪了',
  '核验了',
  '缩小了',
  '恢复了',
  '说明了',
  '隔离了',
  '连接了',
  '标记了',
  '预留了',
  '刷新了',
  '复述了',
  '分配了',
  '固定了',
  '简化了',
  '对齐了',
  '排序了',
  '总结了',
] as const;
const ZH_VARIATION_OBJECTS = [
  '可见基线',
  '关键差异',
  '剩余步骤',
  '周边约束',
  '原始记录',
  '处理结果',
  '时间顺序',
  '检查范围',
  '下一项任务',
  '现场变化',
  '已有清单',
  '重要细节',
  '异常位置',
  '停止标准',
  '使用顺序',
  '稍后日程',
  '可见结果',
  '对照信息',
  '实际进度',
  '待办项目',
  '必要材料',
  '工作边界',
  '主要问题',
  '复查时间',
  '起始现象',
  '结束状态',
  '操作次序',
  '限制条件',
  '已知差别',
  '独立证据',
  '目标区域',
  '候选方案',
  '交接内容',
  '观察窗口',
  '风险边界',
  '验证方法',
  '所需动作',
  '暂缓事项',
  '原有设置',
  '归纳判断',
  '核对范围',
  '时间节点',
  '完成证据',
  '复用步骤',
  '实际变化',
  '剩余差异',
  '记录结构',
  '参考位置',
] as const;
const ZH_VARIATION_RESULTS = [
  '内容已经足够清楚',
  '结果仍然保持稳定',
  '下一步可以直接开始',
  '剩余问题容易继续追踪',
  '当前范围没有继续扩大',
  '记录能够支持后续复核',
  '变化已经可以单独描述',
  '处理顺序没有遗漏步骤',
  '现有信息不需要额外推测',
  '完成状态可以明确判断',
  '周边约束还需要另行观察',
  '稍后日程仍然留有调整余地',
  '关键结果已经分别写明',
  '这次检查形成了有效对照',
  '当前结论只覆盖实际范围',
  '下一轮能够沿用相同方法',
  '信息已经能够独立复查',
  '原始现象与结果保持分离',
  '现有步骤足以重复执行',
  '边界没有因处理而变模糊',
  '对照项仍然可以继续使用',
  '新的记录便于后续交接',
  '变化和动作已经逐项对应',
  '结论没有超出可见证据',
  '任务可以在此处安全停止',
  '下一位参与者能直接接手',
  '复查入口已经明确保留',
  '本轮动作没有引入新依赖',
  '剩余事项可以单独安排',
  '观察窗口仍然保持一致',
  '验收条件已经写得具体',
  '处理过程留下了完整线索',
] as const;

const EN_VARIATION_ADVERBS = [
  'Afterward',
  'Currently',
  'At the same time',
  'Finally',
  'Next',
  'Again',
  'One item at a time',
  'Separately',
  'Promptly',
  'Directly',
  'Provisionally',
  'In full',
  'In order',
  'On site',
  'During review',
  'Before closing',
  'A little later',
  'On the spot',
  'As planned',
  'After confirmation',
  'Before handoff',
  'From the beginning',
  'In the following round',
  'While organizing',
  'After comparison',
  'At the end of the note',
  'By the checklist',
  'Within the stated limit',
  'During the repeat check',
  'After preparation',
  'While conditions were stable',
  'Once the result was clear',
] as const;
const EN_VARIATION_ACTORS = [
  'the recorder',
  'the owner',
  'the observer',
  'the maintainer',
  'the participant',
  'the organizer',
  'the reviewer',
  'the duty worker',
  'the reader',
  'a household member',
  'the operator',
  'the inspector',
  'a colleague',
  'the administrator',
  'the user',
  'the plan owner',
  'the coordinator',
  'the duty partner',
  'the note organizer',
  'an on-site collaborator',
  'the task owner',
  'the material keeper',
  'a participant in this round',
  'the checklist author',
  'the process observer',
  'the handoff recipient',
  'the point of contact',
  'the test operator',
  'the log keeper',
  'the reading-note author',
  'the planning coordinator',
  'the result verifier',
] as const;
const EN_VARIATION_ACTIONS = [
  'checked',
  'recorded',
  'inspected',
  'organized',
  'adjusted',
  'confirmed',
  'compared',
  'preserved',
  'updated',
  'marked',
  'removed',
  'added',
  'reviewed',
  'measured',
  'summarized',
  'scheduled',
  'followed up on',
  'validated',
  'cleaned',
  'collected',
  'split',
  'combined',
  'observed',
  'tested',
  'calibrated',
  'filtered',
  'arranged',
  'rewrote',
  'archived',
  'bounded',
  'listed',
  'tracked',
  'verified',
  'narrowed',
  'restored',
  'described',
  'isolated',
  'connected',
  'flagged',
  'reserved',
  'refreshed',
  'restated',
  'assigned',
  'fixed',
  'simplified',
  'aligned',
  'sorted',
  'summarized',
] as const;
const EN_VARIATION_OBJECTS = [
  'the visible baseline',
  'the key difference',
  'the remaining steps',
  'the relevant conditions',
  'the original record',
  'the handling result',
  'the time order',
  'the inspection range',
  'the next task',
  'the visible change',
  'the existing checklist',
  'the important details',
  'the unusual location',
  'the completion condition',
  'the usage order',
  'the later schedule',
  'the visible result',
  'the comparison details',
  'the actual progress',
  'the pending items',
  'the necessary material',
  'the working boundary',
  'the main issue',
  'the review time',
  'the initial symptom',
  'the end state',
  'the operation order',
  'the limiting condition',
  'the known difference',
  'the independent evidence',
  'the target area',
  'the candidate approach',
  'the handoff content',
  'the observation window',
  'the risk boundary',
  'the validation method',
  'the required action',
  'the deferred item',
  'the original setting',
  'the conclusion for this round',
  'the comparison scope',
  'the time marker',
  'the completion evidence',
  'the reusable steps',
  'the actual change',
  'the remaining difference',
  'the note structure',
  'the reference location',
] as const;
const EN_VARIATION_RESULTS = [
  'the note is now clear enough',
  'the result remains stable',
  'the next step can begin directly',
  'the remaining issue stays straightforward to trace',
  'the current scope has not expanded',
  'the record supports a later review',
  'the change can be described separately',
  'the sequence contains every required step',
  'the available evidence needs no guesswork',
  'the finished state can be identified clearly',
  'the relevant condition still needs observation',
  'the later schedule retains room for adjustment',
  'the key results are written separately',
  'this check provides a useful comparison',
  'the conclusion covers only the inspected area',
  'a subsequent round can reuse the same method',
  'the information can now be checked independently',
  'the original symptom remains separate from the result',
  'the existing steps are sufficient for a repeat',
  'the boundary remained clear during the work',
  'the comparison item is still available',
  'the new note makes a later handoff easier',
  'each change is paired with its action',
  'the conclusion stays within the visible evidence',
  'the task can stop safely at this point',
  'another participant can continue directly',
  'the route for a later check remains clear',
  'this round introduced no new dependency',
  'the remaining item can be scheduled separately',
  'the observation window stayed consistent',
  'the acceptance condition is now specific',
  'the process left a complete trail',
] as const;

const ZH_LEXICONS: Record<V2RNoteCategory, Lexicon> = {
  'field-observation': {
    subjects: [
      '窗边的薄荷',
      '步道旁的土壤',
      '西侧水槽',
      '储物间的纸箱',
      '阳台上的幼苗',
      '门口的雨水槽',
    ],
    settings: [
      '晨间巡看时',
      '午后光线稳定时',
      '雨停后的短暂间隙',
      '整理工具之前',
      '第二次经过时',
      '通风结束以后',
    ],
    observations: [
      '叶面比前次更舒展',
      '表层仍保留少量水分',
      '边缘出现了轻微积灰',
      '标签位置容易被遮住',
      '颜色变化集中在向光一侧',
      '触感与上次记录基本一致',
    ],
    actions: [
      '补记了相邻位置的差异',
      '把观察范围缩小到同一区域',
      '用相同角度再看了一遍',
      '保留现状等待下一次比较',
      '移开遮挡物后重新确认',
      '记录了光线变化前后的区别',
    ],
    outcomes: [
      '下次可以直接比较同一位置',
      '暂时没有必要扩大处理范围',
      '变化仍需另一轮观察确认',
      '现有记录足以支持后续判断',
      '异常范围已经能够明确描述',
      '下一步只需要复核一个变量',
    ],
  },
  'maintenance-log': {
    subjects: ['桌灯开关', '厨房水龙头', '门轴', '小型风扇', '收纳柜滑轨', '充电线接头'],
    settings: [
      '例行检查时',
      '再次出现异响以后',
      '清洁表面之前',
      '完成日常使用以后',
      '负载较低的时候',
      '重新连接以后',
    ],
    observations: [
      '响应比平时慢一些',
      '接触位置有轻微松动',
      '连续运行时声音不均匀',
      '开合到中段会产生阻力',
      '表面没有发现明显损伤',
      '问题只在特定角度出现',
    ],
    actions: [
      '清理接触面并重新固定',
      '只调整了最松的一处连接',
      '保持原位置重复测试三次',
      '更换方向后再次检查',
      '记录现象但没有继续拆解',
      '恢复原设置以便对照',
    ],
    outcomes: [
      '目前能够稳定完成一次操作',
      '症状减轻但仍需要复查',
      '可以排除外部遮挡的影响',
      '下一轮应继续观察连接处',
      '无需立即更换部件',
      '维护结果已经留下可复现步骤',
    ],
  },
  'meeting-note': {
    subjects: [
      '本周交付范围',
      '资料整理顺序',
      '下次复核时间',
      '共享清单的维护方式',
      '问题反馈入口',
      '阶段目标的表述',
    ],
    settings: [
      '短会开始后',
      '讨论进入收束阶段时',
      '对照旧记录时',
      '确认分工之前',
      '列出主要分歧以后',
      '逐项复述结论时',
    ],
    observations: [
      '两种方案的成本差异主要在准备阶段',
      '现有描述容易混淆目标和手段',
      '负责人与完成条件还没有绑定',
      '部分问题可以延后到验证之后',
      '大家对优先级已有一致理解',
      '仍有一个依赖项需要单独确认',
    ],
    actions: [
      '把结论改写成可检查的动作',
      '将未决事项移入独立清单',
      '为每项决定补上负责人',
      '删除了重复且没有信息量的条目',
      '保留两条证据供下次复核',
      '按影响范围重新安排顺序',
    ],
    outcomes: [
      '会后可以直接按清单推进',
      '下一次讨论只需处理剩余分歧',
      '交接时不会遗漏验收条件',
      '范围变化能够被及时发现',
      '决定与依据已经清楚分开',
      '当前版本适合作为下一轮起点',
    ],
  },
  'reading-note': {
    subjects: [
      '这一节关于注意力的讨论',
      '作者对日常观察的解释',
      '案例中的决策过程',
      '章节末尾的反例',
      '关于习惯形成的段落',
      '一段有关记录方法的说明',
    ],
    settings: [
      '读完第一遍后',
      '回看页边标记时',
      '把观点放回上下文时',
      '尝试复述核心论点时',
      '对照自己的旧笔记时',
      '整理摘录之前',
    ],
    observations: [
      '关键不在增加步骤而在缩短反馈',
      '例子说明环境会改变默认选择',
      '结论依赖一个容易忽略的前提',
      '反例让原来的解释显得过于宽泛',
      '论证在具体场景中更有说服力',
      '概念之间仍缺少一层清楚连接',
    ],
    actions: [
      '用自己的话重写了主要观点',
      '删去脱离上下文的单句摘录',
      '补上这个结论成立的条件',
      '记下一个可以实际验证的问题',
      '把反例与原观点并排记录',
      '暂时保留疑问等待后文回应',
    ],
    outcomes: [
      '复习时能够先看到论证结构',
      '这条笔记不再依赖原文措辞',
      '下一次阅读有了明确关注点',
      '观点和个人判断已经分开',
      '当前疑问可以在后续章节检验',
      '笔记保留了足够的上下文',
    ],
  },
  'household-plan': {
    subjects: ['周末采购', '冰箱整理', '换季衣物收纳', '厨房清洁', '阳台工具归位', '下周简餐准备'],
    settings: [
      '列清单时',
      '查看现有库存以后',
      '安排周末时间之前',
      '完成第一轮整理后',
      '比较家庭成员的时间时',
      '准备出门以前',
    ],
    observations: [
      '现有用品足够覆盖前半周',
      '最占空间的是暂时不用的物品',
      '两个任务可以共用一次准备工作',
      '容易遗漏的是清洁后的归位',
      '计划中留出的缓冲时间偏少',
      '需要购买的项目比预想更少',
    ],
    actions: [
      '按使用频率重新排列顺序',
      '删除已经有库存的采购项',
      '把耗时较长的任务拆成两段',
      '先完成会影响其他人的部分',
      '为最后收尾预留单独时间',
      '将同一路线的事项合并处理',
    ],
    outcomes: [
      '周末安排不会挤占休息时间',
      '采购清单已经缩短到必要项目',
      '每项任务都有明确的结束状态',
      '临时变化仍有调整空间',
      '整理完成后容易维持现状',
      '下一周可以减少重复准备',
    ],
  },
};

const EN_LEXICONS: Record<V2RNoteCategory, Lexicon> = {
  'field-observation': {
    subjects: [
      'the mint beside the window',
      'the soil near the walkway',
      'the western sink',
      'the boxes in the storage room',
      'the seedlings on the balcony',
      'the rain channel by the door',
    ],
    settings: [
      'during the morning walk-through',
      'once the afternoon light was steady',
      'in the short interval after the rain',
      'before the tools were put away',
      'during the second pass through the room',
      'after the room had finished airing',
    ],
    observations: [
      'the leaves were more open than before',
      'the surface still held a little moisture',
      'a thin line of dust remained along the edge',
      'the label was easy to hide from view',
      'the color shift stayed on the brighter side',
      'the texture matched the previous note',
    ],
    actions: [
      'recorded the neighboring area for comparison',
      'narrowed the observation to the same small section',
      'checked the surface again from the same angle',
      'left the setting unchanged for another pass',
      'moved the obstruction and repeated the check',
      'noted the difference before and after the light changed',
    ],
    outcomes: [
      'the next visit can compare the same location',
      'there is no reason to widen the intervention yet',
      'another observation is needed before calling it a change',
      'the note now supports a focused follow-up',
      'the affected area can be described without guessing',
      'the next pass only needs to isolate one variable',
    ],
  },
  'maintenance-log': {
    subjects: [
      'the desk lamp switch',
      'the kitchen faucet',
      'the door hinge',
      'the small fan',
      'the storage drawer rail',
      'the charging cable connector',
    ],
    settings: [
      'during the routine check',
      'after the noise appeared again',
      'before cleaning the surface',
      'after normal use had finished',
      'while the load was low',
      'after reconnecting the cable',
    ],
    observations: [
      'the response was slower than usual',
      'the contact point had a small amount of play',
      'the sound varied during continuous use',
      'resistance appeared halfway through the movement',
      'the surface showed no visible damage',
      'the symptom occurred at only one angle',
    ],
    actions: [
      'cleaned the contact and secured it again',
      'adjusted only the loosest connection',
      'repeated the same test three times',
      'changed the direction and checked once more',
      'recorded the symptom without opening the housing',
      'restored the original setting for comparison',
    ],
    outcomes: [
      'one full operation now completes reliably',
      'the symptom is weaker but still needs review',
      'an external obstruction can be ruled out',
      'the next check should stay focused on the connection',
      'there is no immediate need to replace the part',
      'the maintenance step can be reproduced later',
    ],
  },
  'meeting-note': {
    subjects: [
      'this week’s delivery boundary',
      'the order for organizing the references',
      'the timing of the next review',
      'ownership of the shared checklist',
      'the route for reporting issues',
      'the wording of the current milestone',
    ],
    settings: [
      'after the short meeting began',
      'as the discussion moved toward a decision',
      'while comparing the earlier notes',
      'before responsibilities were confirmed',
      'after the main disagreement was listed',
      'during the final read-back of decisions',
    ],
    observations: [
      'the two options differ mainly in preparation cost',
      'the current wording mixes the goal with the method',
      'owners are not yet tied to completion conditions',
      'some questions can wait until after validation',
      'the group already agrees on the first priority',
      'one dependency still needs a separate answer',
    ],
    actions: [
      'rewrote the decision as an observable action',
      'moved unresolved items into a separate list',
      'added an owner beside every accepted task',
      'removed repeated entries that carried no new information',
      'kept two pieces of evidence for the next review',
      'reordered the work by its affected scope',
    ],
    outcomes: [
      'the checklist can guide the work immediately',
      'the next meeting can focus on the remaining disagreement',
      'the handoff now includes every acceptance condition',
      'a scope change will be visible as soon as it occurs',
      'the decision is clearly separated from its evidence',
      'the current note is a stable starting point for the next pass',
    ],
  },
  'reading-note': {
    subjects: [
      'the section on sustained attention',
      'the author’s explanation of ordinary observation',
      'the decision process in the example',
      'the counterexample at the end of the chapter',
      'the passage about forming habits',
      'the explanation of practical note taking',
    ],
    settings: [
      'after the first reading',
      'while reviewing the margin marks',
      'after putting the claim back into context',
      'while restating the main argument',
      'when comparing an older note',
      'before organizing the excerpts',
    ],
    observations: [
      'the main benefit comes from shorter feedback rather than more steps',
      'the example shows how surroundings alter the default choice',
      'the conclusion depends on an easily missed assumption',
      'the counterexample makes the original claim too broad',
      'the argument becomes stronger in a concrete setting',
      'one link between the concepts is still missing',
    ],
    actions: [
      'rewrote the main claim in plain language',
      'removed a quotation that had lost its context',
      'added the condition required by the conclusion',
      'recorded one question that can be tested in practice',
      'placed the counterexample beside the original claim',
      'kept the question open for a later chapter',
    ],
    outcomes: [
      'the argument structure will be visible during review',
      'the note no longer depends on the original wording',
      'the next reading has a specific point to watch',
      'the author’s claim is separated from the reader’s judgment',
      'a later chapter can test the open question',
      'the note preserves enough context to remain useful',
    ],
  },
  'household-plan': {
    subjects: [
      'the weekend shopping list',
      'the refrigerator cleanout',
      'seasonal clothing storage',
      'the kitchen cleaning pass',
      'the balcony tool shelf',
      'simple meals for next week',
    ],
    settings: [
      'while drafting the list',
      'after checking the existing supplies',
      'before setting aside the weekend time',
      'after the first organizing pass',
      'while comparing everyone’s availability',
      'before leaving the house',
    ],
    observations: [
      'the current supplies cover the first half of the week',
      'items not in use take most of the available space',
      'two tasks can share the same preparation',
      'putting tools back is the step most likely to be missed',
      'the plan leaves too little buffer time',
      'fewer purchases are needed than expected',
    ],
    actions: [
      'reordered the work by frequency of use',
      'removed items that are already in stock',
      'split the longest task into two sessions',
      'scheduled the part that affects other people first',
      'reserved a separate interval for the final reset',
      'combined errands that follow the same route',
    ],
    outcomes: [
      'the plan protects the weekend rest period',
      'the shopping list now contains only necessary items',
      'every task has a clear finished state',
      'there is still room for an unexpected change',
      'the organized state will be easier to maintain',
      'next week will require less repeated preparation',
    ],
  },
};

export function resolveProjectOwnedV3Root(workspaceRoot: string = V2R_REPOSITORY_ROOT): string {
  return path.join(resolveV2RCacheRoot(workspaceRoot), 'generated-project-owned-v3.1');
}

export function generateProjectOwnedDocumentV3(
  plan: ProjectOwnedSourcePlanV3,
  index: number,
  seed = PROJECT_OWNED_GENERATOR_V3_SEED,
): GeneratedProjectOwnedDocumentV3 {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new Error('Document index must be non-negative.');
  const lexicon = plan.language === 'zh' ? ZH_LEXICONS[plan.category] : EN_LEXICONS[plan.category];
  const digest = sha256(`${seed}\0${plan.id}\0${index}`);
  const picks = [0, 2, 4, 6, 8].map((offset) =>
    Number.parseInt(digest.slice(offset, offset + 2), 16),
  );
  const subject = lexicon.subjects[picks[0]! % lexicon.subjects.length]!;
  const setting = lexicon.settings[picks[1]! % lexicon.settings.length]!;
  const observation = lexicon.observations[picks[2]! % lexicon.observations.length]!;
  const action = lexicon.actions[picks[3]! % lexicon.actions.length]!;
  const outcome = lexicon.outcomes[picks[4]! % lexicon.outcomes.length]!;
  const comparisonDetails = plan.language === 'zh' ? ZH_COMPARISON_DETAILS : EN_COMPARISON_DETAILS;
  const comparisonDetail =
    comparisonDetails[Number.parseInt(digest.slice(10, 12), 16) % comparisonDetails.length]!;
  const summaryNouns = plan.language === 'zh' ? ZH_SUMMARY_NOUNS : EN_SUMMARY_NOUNS;
  const summaryAdverbs = plan.language === 'zh' ? ZH_SUMMARY_ADVERBS : EN_SUMMARY_ADVERBS;
  const summaryVerbs = plan.language === 'zh' ? ZH_SUMMARY_VERBS : EN_SUMMARY_VERBS;
  const summaryNoun =
    summaryNouns[Number.parseInt(digest.slice(22, 24), 16) % summaryNouns.length]!;
  const summaryAdverb =
    summaryAdverbs[Number.parseInt(digest.slice(24, 26), 16) % summaryAdverbs.length]!;
  const summaryVerb =
    summaryVerbs[Number.parseInt(digest.slice(26, 28), 16) % summaryVerbs.length]!;
  const firstMeasure = 2 + (Number.parseInt(digest.slice(12, 16), 16) % 47);
  const secondMeasure = 3 + (Number.parseInt(digest.slice(16, 20), 16) % 113);
  const template = Number.parseInt(digest.slice(20, 22), 16) % 32;
  const composed = composeDocument(
    plan.language,
    {
      subject,
      setting,
      observation,
      action,
      outcome,
      comparisonDetail,
      summaryNoun,
      summaryAdverb,
      summaryVerb,
    },
    firstMeasure,
    secondMeasure,
    template,
    digest,
  );
  const text = composed.text;
  const documentId = `${plan.id}-${index.toString().padStart(6, '0')}`;
  const relativePath = `${plan.relativeDirectory}/${documentId}.md`;
  return {
    documentId,
    sourceId: plan.id,
    language: plan.language,
    category: plan.category,
    relativePath,
    text,
    generatorVersion: PROJECT_OWNED_GENERATOR_V3,
    generatorSeed: seed,
    templateId: `${plan.language}:${plan.category}:${composed.templateId}`,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: sha256(text),
  };
}

export function generateProjectOwnedDocumentsV3(
  documentsPerSource: number,
  seed = PROJECT_OWNED_GENERATOR_V3_SEED,
): GeneratedProjectOwnedDocumentV3[] {
  if (!Number.isSafeInteger(documentsPerSource) || documentsPerSource < 1) {
    throw new Error('documentsPerSource must be positive.');
  }
  return PROJECT_OWNED_SOURCE_PLANS_V3.flatMap((plan) =>
    Array.from({ length: documentsPerSource }, (_, index) =>
      generateProjectOwnedDocumentV3(plan, index, seed),
    ),
  );
}

/**
 * Generator-owned Chinese segmentation points. Chinese has no whitespace word
 * boundary. These offsets identify sentence/clause starts and explicit
 * compositional slots; the training-data layer adds a bounded deterministic
 * sample of interior code-point boundaries for natural mid-sentence coverage.
 */
export function collectProjectOwnedChineseCursorOffsets(text: string): number[] {
  const cursors = new Set<number>();
  let lineOffset = 0;
  for (const line of text.split('\n')) {
    const prefix = line.match(/^\s{0,3}(?:(?:[-+*]|\d+[.)]|>)\s+)?(?:记录[一二三四]：)?/u)?.[0];
    const contentStart = lineOffset + (prefix?.length ?? 0);
    if (/\p{Script=Han}/u.test(text[contentStart] ?? '')) cursors.add(contentStart);
    for (const match of line.matchAll(/[，；：]/gu)) {
      const cursor = lineOffset + (match.index ?? 0);
      if (/\p{Script=Han}/u.test(text[cursor - 1] ?? '') && cursor < text.length - 1) {
        cursors.add(cursor);
      }
    }
    lineOffset += line.length + 1;
  }

  const boundaries = ['这份', ...ZH_SUMMARY_NOUNS, ...ZH_SUMMARY_ADVERBS, ...ZH_SUMMARY_VERBS];
  for (const boundary of boundaries) {
    let offset = 0;
    while (offset < text.length) {
      const index = text.indexOf(boundary, offset);
      if (index < 0) break;
      const cursor = index + boundary.length;
      if (/\p{Script=Han}/u.test(text[cursor] ?? '')) cursors.add(cursor);
      offset = Math.max(cursor, index + 1);
    }
  }
  return [...cursors].sort((left, right) => left - right);
}

export function buildProjectOwnedSourceRegistryV3(
  documents: readonly GeneratedProjectOwnedDocumentV3[],
  collectedAt: string,
  seed = PROJECT_OWNED_GENERATOR_V3_SEED,
): V2RCorpusSource[] {
  if (
    !Number.isFinite(Date.parse(collectedAt)) ||
    new Date(collectedAt).toISOString() !== collectedAt
  ) {
    throw new Error('collectedAt must be a canonical ISO timestamp.');
  }
  return PROJECT_OWNED_SOURCE_PLANS_V3.map((plan) => {
    const members = documents
      .filter((document) => document.sourceId === plan.id)
      .sort((left, right) => left.documentId.localeCompare(right.documentId));
    if (members.length === 0) throw new Error(`Source ${plan.id} has no generated documents.`);
    if (
      members.some(
        (document) =>
          document.generatorVersion !== PROJECT_OWNED_GENERATOR_V3 ||
          document.generatorSeed !== seed ||
          document.language !== plan.language ||
          document.category !== plan.category,
      )
    ) {
      throw new Error(`Source ${plan.id} contains inconsistent generator provenance.`);
    }
    return {
      id: plan.id,
      kind: 'project-owned',
      language: plan.language,
      category: plan.category,
      contentRoot: plan.relativeDirectory,
      licenseSpdx: 'MIT',
      licenseEvidencePath: 'LICENSE',
      contentTreeSha256: canonicalSha256(
        members.map((document) => ({ id: document.documentId, sha256: document.sha256 })),
      ),
      collectedAt,
      cleanerVersion: PROJECT_OWNED_GENERATOR_V3,
      generatorVersion: PROJECT_OWNED_GENERATOR_V3,
      generatorSeed: seed,
    };
  });
}

function composeDocument(
  language: V2RLanguage,
  values: {
    subject: string;
    setting: string;
    observation: string;
    action: string;
    outcome: string;
    comparisonDetail: string;
    summaryNoun: string;
    summaryAdverb: string;
    summaryVerb: string;
  },
  firstMeasure: number,
  secondMeasure: number,
  template: number,
  digest: string,
): { text: string; templateId: string } {
  const variationFrames = Array.from({ length: 24 }, (_, index) =>
    buildVariation(language, sha256(`${digest}\0variation-${index}`)),
  );
  let frames: string[];
  if (language === 'zh') {
    frames = [
      `${values.setting}，${values.subject}${values.observation}。`,
      `关于${values.subject}的记录显示，${values.observation}。`,
      `本次只关注${values.subject}：${values.observation}。`,
      `初步检查${values.subject}时发现，${values.observation}。`,
      `处理前先查看${values.subject}，当时${values.observation}。`,
      `再次查看${values.subject}后，仍可确认${values.observation}。`,
      `围绕${values.subject}，本次${values.action}。`,
      `为了保留现场原貌，记录中${values.action}。`,
      `复核过程中${values.action}，用时约${firstMeasure}分钟。`,
      `检查${secondMeasure}个位置后，${values.outcome}。`,
      `${values.comparisonDetail}。`,
      `为了便于下一次比较，现场${values.action}。`,
      `目前的结果是${values.outcome}。`,
      `当前记录${values.summaryAdverb}${values.summaryVerb}${values.outcome}。`,
      `${values.summaryNoun}给出的结论是：${values.outcome}。`,
      `稍后只需要确认${values.subject}是否仍与这次观察一致。`,
      `接下来会留意${values.subject}，暂不扩大范围。`,
      `如果没有新的变化，将按原顺序再次复核。`,
      ...variationFrames,
    ];
  } else {
    frames = [
      `${capitalize(values.setting)}, ${values.subject} showed that ${values.observation}.`,
      `The note for ${values.subject} records that ${values.observation}.`,
      `This pass focused on ${values.subject}; ${values.observation}.`,
      `An initial look at ${values.subject} showed that ${values.observation}.`,
      `Before any adjustment, the record for ${values.subject} noted that ${values.observation}.`,
      `Looking again at ${values.subject} confirmed that ${values.observation}.`,
      `${capitalize(values.setting)}, the observed condition was that ${values.observation}.`,
      `The follow-up ${values.action} and kept the scope limited.`,
      `During the check, the observer ${values.action}.`,
      `The work took about ${firstMeasure} minutes and ${values.action}.`,
      `After checking ${secondMeasure} nearby points, ${values.outcome}.`,
      `One comparison note was that ${values.comparisonDetail}.`,
      `To make the next review easier, the observer ${values.action}.`,
      `The current result is that ${values.outcome}.`,
      `This ${values.summaryNoun} ${values.summaryAdverb} ${values.summaryVerb} that ${values.outcome}.`,
      `${capitalize(values.summaryNoun)}: ${values.outcome}.`,
      `The next pass will check whether ${values.subject} remains in the same state.`,
      `No wider action is planned until ${values.subject} changes again.`,
      `If the condition remains stable, the same sequence will be used again.`,
      ...variationFrames,
    ];
  }
  const lineCount = 3 + (Number.parseInt(digest.slice(44, 46), 16) % 3);
  const selected = frames
    .map((text, index) => ({
      index,
      text,
      order: sha256(`${digest}\0frame-${index}`),
    }))
    .sort((left, right) => left.order.localeCompare(right.order))
    .slice(0, lineCount);
  const layout = template % 6;
  const lines = selected.map(({ text }) => text);
  let text: string;
  if (layout === 0) text = lines.join('\n\n');
  else if (layout === 1) text = lines.join('\n');
  else if (layout === 2) text = lines.map((line) => `- ${line}`).join('\n');
  else if (layout === 3) text = lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
  else if (layout === 4) {
    text = lines.map((line, index) => (index === 0 ? `> ${line}` : `- ${line}`)).join('\n');
  } else text = lines.map((line) => `> ${line}`).join('\n');
  return {
    text,
    templateId: `layout-${layout}:frames-${selected.map(({ index }) => index).join('-')}`,
  };
}

function buildVariation(language: V2RLanguage, digest: string): string {
  const pick = <T>(values: readonly T[], offset: number): T =>
    values[Number.parseInt(digest.slice(offset, offset + 2), 16) % values.length]!;
  if (language === 'zh') {
    const adverb = pick(ZH_VARIATION_ADVERBS, 28);
    const actor = pick(ZH_VARIATION_ACTORS, 30);
    const action = pick(ZH_VARIATION_ACTIONS, 32);
    const object = pick(ZH_VARIATION_OBJECTS, 34);
    const secondAction = pick(ZH_VARIATION_ACTIONS, 36);
    const secondObject = pick(ZH_VARIATION_OBJECTS, 38);
    const result = pick(ZH_VARIATION_RESULTS, 40);
    const structure = Number.parseInt(digest.slice(42, 44), 16) % 16;
    if (structure === 0)
      return `${adverb}，${actor}${action}${object}，并${secondAction}${secondObject}。`;
    if (structure === 1)
      return `${object}完成初检以后，${actor}${secondAction}${secondObject}；${result}。`;
    if (structure === 2)
      return `先由${actor}${action}${object}，随后${secondAction}${secondObject}。`;
    if (structure === 3) return `${actor}${action}${object}。另行核对表明，${result}。`;
    if (structure === 4)
      return `针对${object}，${actor}${secondAction}${secondObject}；${result}。`;
    if (structure === 5) return `${result}，因为${actor}已经${action}${object}。`;
    if (structure === 6) return `这次把${object}和${secondObject}分开核对，${actor}${action}前者。`;
    if (structure === 7)
      return `${adverb}先检查${object}；${actor}随后${secondAction}${secondObject}。`;
    if (structure === 8)
      return `在${object}的范围内，${actor}${action}${secondObject}，${result}。`;
    if (structure === 9) return `${actor}${action}${object}；因此，${result}。`;
    if (structure === 10)
      return `${actor}${secondAction}${secondObject}。现有记录说明，${result}。`;
    if (structure === 11)
      return `关于${object}，本轮只${action}${secondObject}，没有增加其他步骤。`;
    if (structure === 12)
      return `${object}与${secondObject}分别留档，${actor}${adverb}${action}两者。`;
    if (structure === 13)
      return `完成${action}${object}以后，${actor}转而${secondAction}${secondObject}。`;
    if (structure === 14) return `本轮结果容易复查：${actor}${action}${object}，${result}。`;
    return `${adverb}，${object}由${actor}${action}；${secondObject}则保持原样。`;
  }
  const adverb = pick(EN_VARIATION_ADVERBS, 28);
  const actor = pick(EN_VARIATION_ACTORS, 30);
  const action = pick(EN_VARIATION_ACTIONS, 32);
  const object = pick(EN_VARIATION_OBJECTS, 34);
  const secondAction = pick(EN_VARIATION_ACTIONS, 36);
  const secondObject = pick(EN_VARIATION_OBJECTS, 38);
  const result = pick(EN_VARIATION_RESULTS, 40);
  const structure = Number.parseInt(digest.slice(42, 44), 16) % 16;
  if (structure === 0)
    return `${adverb}, ${actor} ${action} ${object} and ${secondAction} ${secondObject}.`;
  if (structure === 1)
    return `Once ${object} had been checked, ${actor} ${secondAction} ${secondObject}; ${result}.`;
  if (structure === 2)
    return `First, ${actor} ${action} ${object}; later, the same person ${secondAction} ${secondObject}.`;
  if (structure === 3) return `${actor} ${action} ${object}. A separate check showed ${result}.`;
  if (structure === 4) return `For ${object}, ${actor} ${secondAction} ${secondObject}; ${result}.`;
  if (structure === 5) return `${capitalize(result)} because ${actor} ${action} ${object}.`;
  if (structure === 6)
    return `This pass kept ${object} apart from ${secondObject}, and ${actor} ${action} the former.`;
  if (structure === 7)
    return `${adverb}, ${object} came first; ${actor} then ${secondAction} ${secondObject}.`;
  if (structure === 8) return `Within ${object}, ${actor} ${action} ${secondObject}, so ${result}.`;
  if (structure === 9) return `${actor} ${action} ${object}; as a result, ${result}.`;
  if (structure === 10)
    return `${actor} ${secondAction} ${secondObject}. The available note indicates that ${result}.`;
  if (structure === 11)
    return `For ${object}, this round only ${action} ${secondObject} and added no other step.`;
  if (structure === 12)
    return `${object} and ${secondObject} were logged separately; ${actor} ${action} both.`;
  if (structure === 13)
    return `Having ${action} ${object}, ${actor} moved on and ${secondAction} ${secondObject}.`;
  if (structure === 14)
    return `Future checking has a clear starting point: ${actor} ${action} ${object}, and ${result}.`;
  return `${adverb}, ${object} was ${action} by ${actor}, while ${secondObject} stayed unchanged.`;
}

function capitalize(value: string): string {
  return value ? value[0]!.toLocaleUpperCase('en-US') + value.slice(1) : value;
}
