import type { TFile } from "obsidian";
import type { Usage } from "../../types/types";

/** 地图里一个文件夹的最终状态；判定优先级见 `resolver.classify`。 */
export type FolderStatus =
	| "matched" // 规则命中且模板存在
	| "matched-missing" // 规则命中但模板缺失 -> 运行时回落默认
	| "fallback" // 无规则命中 -> 默认模板
	| "excluded" // 被 excludesPaths 排除，选择器里看不见
	| "empty-match" // 被 match:"" 抢占
	| "direct" // 条目直连笔记模板，所有文件夹固定用它
	| "no-template"; // 绑定为空，运行时会建空白笔记

/** 逻辑名是按哪一级候选命中的。 */
export type ResolveVia = "prefix" | "my" | "plain" | "direct";

export interface FileRef {
	/** 逻辑名（未解析的原始名） */
	name: string;
	file: TFile | null;
	via: ResolveVia;
	/** 三级候选，按尝试顺序，用于列头展示与排错 */
	candidates: string[];
}

export interface RuleRow {
	/** 1 起 */
	index: number;
	match: string;
	/** 脚本原文（折算 ml.t 之前的形态，即求值后的模板名） */
	templateRaw: string;
	/** 已折算 ml.t 的名字 */
	templateName: string;
	/** 已走三级回退 */
	template: FileRef;
	emptyMatch: boolean;
	/** 与前面某条 match 完全相同（值为 1 起的序号） */
	duplicateOf: number | null;
	/** 前面的 match 是其子串 -> 部分文件夹永远到不了本条 */
	shadowedBy: number | null;
	/** 有多少候选文件夹的首命中是本条 */
	reachCount: number;
	/** 无法折算的表达式原文 */
	unresolved: string[];
}

export interface FolderRow {
	path: string;
	name: string;
	/** 相对 base 的层数 */
	depth: number;
	status: FolderStatus;
	ruleIndex: number | null;
	match: string | null;
	/** 规则指向的模板（可能是 null） */
	template: FileRef | null;
	/** 最终生效模板（matched-missing 时 = 默认模板） */
	effectiveTemplate: FileRef | null;
	/** 命中的排除规则原文 */
	excludedBy: string | null;
}

export interface FolderSettings {
	baseFolder: string;
	showSubFolders: boolean;
	includeParentFolder: boolean;
	matchMode: "segment" | "fuzzy";
	excludeRules: { raw: string; include: boolean }[];
	/** 成果分类：基址被活动笔记改写时的说明，形如 `active:<path>` / `default` */
	contextNote: string | null;
	error: string | null;
}

export interface EntryGroup {
	source: "loader" | "hotkey";
	selector: FileRef;
	folderSettings: FolderSettings;
	/** 该条目自己解析出的绑定，不再继承分类级切换器 */
	binding: SwitcherBinding;
	folders: FolderRow[];
}

/** 选择器/切换器头注释里的声明。 */
export interface SelectorHeader {
	type: "selector" | "switcher" | null;
	/** 已小写；未声明为 null */
	for: string | null;
}

/** 条目绑定：地图能表达的全部运行时形态。 */
export type SwitcherBinding =
	| {
			kind: "switcher";
			/** 切换器文件（可能 file=null，此时 rules 为空） */
			ref: FileRef;
			rules: RuleRow[];
			defaultTemplate: FileRef | null;
			pathMode: boolean;
			/** 切换器头部的 `for:`，用于与分类比对 */
			forHint: string | null;
			/** "target-missing" / "switchers-not-found" / ... */
			parseError: string | null;
	  }
	| { kind: "direct-template"; ref: FileRef }
	| { kind: "none" }
	| { kind: "unresolved"; raw: string; reason: string };

/** 同一分类内按绑定归并；规则表 / 可达数 / 反向索引都以它为单位。 */
export interface BindingGroup {
	/** sw:<path> / dt:<path> / none / unres:<raw> */
	key: string;
	kind: SwitcherBinding["kind"];
	ref: FileRef | null;
	rules: RuleRow[];
	defaultTemplate: FileRef | null;
	pathMode: boolean;
	error: string | null;
	forHint: string | null;
}

/** 未被任何入口挂载、或热键指向了不存在的文件的脚本。 */
export interface UnmountedRow {
	type: "selector" | "switcher" | "unknown";
	name: string;
	path: string;
	file: TFile | null;
	for: string | null;
	reason: "no-hotkey" | "no-selector" | "hotkey-missing";
}

export interface TaskSlot {
	key: string;
	label: string;
	template: FileRef;
}

export interface TaskBranch {
	name: string;
	/** i18n 键（由视图翻译） */
	condition: string;
	baseFolder: string;
}

export interface CategoryMap {
	usage: Usage;
	/** 可能多条（loader + 热键） */
	entries: EntryGroup[];
	/** 按条目绑定归并后的视图单位 */
	bindingGroups: BindingGroup[];
	/** 兼容字段：仅当分类只有一个切换器绑定时才有值 */
	switcher: FileRef | null;
	/** 兼容字段：同上 */
	pathMode: boolean;
	/** 兼容字段：同上 */
	rules: RuleRow[];
	/** 兼容字段：同上 */
	defaultTemplate: FileRef | null;
	taskSlots?: TaskSlot[];
	taskBranches?: TaskBranch[];
	error: string | null;
}

export interface ReverseIndexRow {
	template: TFile;
	refs: { usage: Usage; ruleIndex: number | null; folderCount: number }[];
}

export interface TemplateMapModel {
	generatedAt: number;
	locale: "en" | "zh-cn" | "zh-tw";
	localeSource: "ioto-update" | "obsidian";
	prefix: string;
	useUserTemplate: boolean;
	categories: CategoryMap[];
	reverseIndex: ReverseIndexRow[];
	unmounted: UnmountedRow[];
	orphans: {
		missingTargets: {
			usage: Usage;
			/** null = 默认模板 / 绑定目标 */
			ruleIndex: number | null;
			name: string;
			source: "rule" | "default" | "binding";
		}[];
		unreferencedTemplates: TFile[];
	};
	warnings: string[];
}

/** 默认四个入场的卡片顺序，和运行时的四个入口一致。 */
export const DEFAULT_CATEGORY_ORDER: Usage[] = [
	"Input",
	"Output",
	"Outcome",
	"Task",
];

/** 兼容别名：保持既有调用点不变，实际含义是「默认四类」。 */
export const CATEGORY_ORDER = DEFAULT_CATEGORY_ORDER;

/** 选择器头 `** for:` 到分类的映射；`Custom` 由入口惰性带出。 */
export const USAGE_BY_FOR: Record<string, Usage> = {
	input: "Input",
	output: "Output",
	task: "Task",
	outcome: "Outcome",
	custom: "Custom",
};

/** 非默认分类的固定展示顺序。 */
export const EXTRA_CATEGORY_ORDER: Usage[] = ["Custom"];
