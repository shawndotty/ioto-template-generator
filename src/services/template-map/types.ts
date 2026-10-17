import type { TFile } from "obsidian";
import type { Usage } from "../../types/types";

/** 地图里一个文件夹的最终状态；判定优先级见 `resolver.classify`。 */
export type FolderStatus =
	| "matched" // 规则命中且模板存在
	| "matched-missing" // 规则命中但模板缺失 -> 运行时回落默认
	| "fallback" // 无规则命中 -> 默认模板
	| "excluded" // 被 excludesPaths 排除，选择器里看不见
	| "empty-match"; // 被 match:"" 抢占

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
	folders: FolderRow[];
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
	switcher: FileRef | null;
	pathMode: boolean;
	rules: RuleRow[];
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
	orphans: {
		missingTargets: { usage: Usage; ruleIndex: number; name: string }[];
		unreferencedTemplates: TFile[];
	};
	warnings: string[];
}

/** 分类卡片顺序固定，和运行时的四个入口一致。 */
export const CATEGORY_ORDER: Usage[] = ["Input", "Output", "Outcome", "Task"];
