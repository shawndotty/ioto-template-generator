import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import type IOTOTemplateGeneratorPlugin from "../../main";
import type { Usage } from "../../types/types";
import {
	IotoSettings,
	IotoSettingsService,
} from "../ioto-settings-services";
import {
	classify,
	folderPrefix,
	folderVisible,
	isPathUnder,
	pickRule,
	resolveName,
	splitExcludeRules,
	type ResolveContext,
} from "./resolver";
import {
	createMl,
	createPassthroughMl,
	extractMlDicts,
	normalizeLocale,
	type Locale,
	type Ml,
} from "./multilang";
import { parseFolderSettings, parseHeader, parseSelectorBinding, parseSwitcherRules } from "./parser";
import {
	BindingGroup,
	CategoryMap,
	DEFAULT_CATEGORY_ORDER,
	EntryGroup,
	EXTRA_CATEGORY_ORDER,
	FileRef,
	FolderRow,
	FolderSettings,
	ReverseIndexRow,
	RuleRow,
	SelectorHeader,
	SwitcherBinding,
	TaskBranch,
	TaskSlot,
	TemplateMapModel,
	UnmountedRow,
	USAGE_BY_FOR,
} from "./types";

interface ContentCacheEntry {
	mtime: number;
	text: string;
}

interface CachedSwitcher {
	type: SelectorHeader["type"];
	rules: RuleRow[];
	pathMode: boolean;
	defaultTemplateName: string | null;
	forHint: string | null;
	error: string | null;
}

interface HotkeySelector {
	file: TFile;
	header: SelectorHeader;
}

interface HotkeyScan {
	entries: HotkeySelector[];
	/** 清单里指向不存在（或不是 md）的路径，不再静默丢弃 */
	brokenPaths: string[];
}

/** 分类规格：默认四类各有 loader/切换器键，Custom 只有兜底笔记模板。 */
const CATEGORY_SPEC: Record<
	Usage,
	{ selectorKey: string | null; switcherKey: string | null; noteKey: string }
> = {
	Input: {
		selectorKey: "IOTODefaultInputSelector",
		switcherKey: "IOTODefaultInputSwitcherTemplate",
		noteKey: "IOTODefaultInputNoteTemplate",
	},
	Output: {
		selectorKey: "IOTODefaultOutputSelector",
		switcherKey: "IOTODefaultOutputSwitcherTemplate",
		noteKey: "IOTODefaultOutputNoteTemplate",
	},
	Outcome: {
		selectorKey: "IOTODefaultOutcomeSelector",
		switcherKey: "IOTODefaultOutcomeSwitcherTemplate",
		noteKey: "IOTODefaultOutcomeNoteTemplate",
	},
	Task: {
		selectorKey: "IOTODefaultTaskSelector",
		switcherKey: "IOTODefaultTaskSwitcherTemplate",
		noteKey: "IOTODefaultTaskNoteTemplate",
	},
	Custom: {
		selectorKey: null,
		switcherKey: null,
		noteKey: "IOTODefaultCustomNoteTemplate",
	},
};

/** 绑定归并键：切换器/直连按文件路径，空与无法解析各自成组。 */
function bindingKey(binding: SwitcherBinding): string {
	switch (binding.kind) {
		case "switcher":
			return `sw:${binding.ref.file?.path ?? binding.ref.name}`;
		case "direct-template":
			return `dt:${binding.ref.file?.path ?? binding.ref.name}`;
		case "none":
			return "none";
		default:
			return `unres:${binding.raw}`;
	}
}

interface IotoUpdateLike {
	settings?: { iotoRunningLanguage?: unknown };
}

interface MlRuntime {
	ml: Ml;
	locale: Locale;
	localeSource: "ioto-update" | "obsidian";
	dictOk: boolean;
}

/**
 * 读 vault / 插件设置，组装 `TemplateMapModel`。
 *
 * 数据源是运行时那条链（Templater loader → 选择器脚本 → 切换器脚本 → 模板文件），
 * 不是插件 `data.json`。只读 4~6 个 `.md` 与 1 个 `.js`，并按 mtime 缓存。
 */
export class TemplateMapBuilder {
	private contentCache = new Map<string, ContentCacheEntry>();

	constructor(
		private app: App,
		private plugin: IOTOTemplateGeneratorPlugin,
	) {}

	async build(): Promise<TemplateMapModel> {
		const generatedAt = Date.now();
		const ioto = new IotoSettingsService(this.app).getSettings();

		if (!ioto) {
			return {
				generatedAt,
				locale: "en",
				localeSource: "obsidian",
				prefix: "My",
				useUserTemplate: true,
				categories: [],
				reverseIndex: [],
				unmounted: [],
				orphans: { missingTargets: [], unreferencedTemplates: [] },
				warnings: ["no-ioto-settings"],
			};
		}

		const warnings: string[] = [];
		const runtime = await this.loadMl(ioto);
		if (!runtime.dictOk) warnings.push("dict-unavailable");

		const prefix = String(ioto.userTemplatePrefix || "My");
		const useUserTemplate = ioto.useUserTemplate !== false;
		const resolveCtx: ResolveContext = {
			prefix,
			useUserTemplate,
			lookup: (name) => this.lookup(name),
		};

		const switcherCache = new Map<string, CachedSwitcher>();
		const hotkeys = await this.collectHotkeySelectors(warnings);
		const extraUsages = EXTRA_CATEGORY_ORDER.filter((usage) =>
			hotkeys.entries.some(
				(item) => USAGE_BY_FOR[item.header.for ?? ""] === usage,
			),
		);

		const categories: CategoryMap[] = [];
		for (const usage of [...DEFAULT_CATEGORY_ORDER, ...extraUsages]) {
			categories.push(
				await this.buildCategory(
					usage,
					ioto,
					runtime.ml,
					resolveCtx,
					switcherCache,
					hotkeys.entries,
					warnings,
				),
			);
		}

		return {
			generatedAt,
			locale: runtime.locale,
			localeSource: runtime.localeSource,
			prefix,
			useUserTemplate,
			categories,
			reverseIndex: this.buildReverseIndex(categories),
			unmounted: await this.collectUnmounted(categories, hotkeys, warnings),
			orphans: this.buildOrphans(categories, warnings),
			warnings,
		};
	}

	// —— 运行时环境 ——

	private lookup(name: string): TFile | null {
		if (!name) return null;
		return this.app.metadataCache.getFirstLinkpathDest(
			normalizePath(name),
			"",
		);
	}

	private async readText(path: string): Promise<string | null> {
		if (!path) return null;
		const normalized = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			const mtime = file.stat?.mtime ?? 0;
			const cached = this.contentCache.get(file.path);
			if (cached && cached.mtime === mtime) return cached.text;
			const text = await this.app.vault.cachedRead(file);
			this.contentCache.set(file.path, { mtime, text });
			return text;
		}
		try {
			return await this.app.vault.adapter.read(normalized);
		} catch {
			return null;
		}
	}

	private async loadMl(ioto: IotoSettings): Promise<MlRuntime> {
		const update = this.app.plugins.plugins["ioto-update"] as
			| IotoUpdateLike
			| undefined;
		const rawValue = update?.settings?.iotoRunningLanguage;
		const raw = typeof rawValue === "string" ? rawValue : "ob";
		const localeSource = raw === "ob" ? "obsidian" : "ioto-update";
		const locale = normalizeLocale(
			raw === "ob" ? moment.locale() : String(raw),
		);

		const frameworkPath =
			String(ioto.IOTOFrameworkPath || "") ||
			(ioto.extraFolder ? `${ioto.extraFolder}/IOTO` : "0-辅助/IOTO");
		const extraFolder = String(ioto.extraFolder || "0-辅助");
		const candidates = [
			`${frameworkPath}/Scripts/IOTOMultiLangs.js`,
			`${extraFolder}/IOTO/Scripts/IOTOMultiLangs.js`,
		].filter((path, index, list) => list.indexOf(path) === index);

		for (const path of candidates) {
			const source = await this.readText(path);
			if (!source) continue;
			const dicts = extractMlDicts(source);
			if (dicts) {
				return {
					ml: createMl(dicts, locale),
					locale,
					localeSource,
					dictOk: true,
				};
			}
			return {
				ml: createPassthroughMl(),
				locale,
				localeSource,
				dictOk: false,
			};
		}

		return {
			ml: createPassthroughMl(),
			locale,
			localeSource,
			dictOk: false,
		};
	}

	// —— 单个分类 ——

	private async buildCategory(
		usage: Usage,
		ioto: IotoSettings,
		ml: Ml,
		resolveCtx: ResolveContext,
		switcherCache: Map<string, CachedSwitcher>,
		hotkeys: HotkeySelector[],
		warnings: string[],
	): Promise<CategoryMap> {
		const spec = CATEGORY_SPEC[usage];
		const switcher = spec.switcherKey
			? resolveName(ml.t(spec.switcherKey), resolveCtx)
			: this.emptyRef("");

		// Custom 没有默认切换器键：不判定 switcher-missing，零入口也就不建卡。
		if (spec.switcherKey && !switcher.file) {
			warnings.push(`switcher-missing:${usage}`);
			return {
				usage,
				entries: [],
				bindingGroups: [],
				switcher,
				pathMode: false,
				rules: [],
				defaultTemplate: null,
				error: "switcher-missing",
			};
		}

		const entries: EntryGroup[] = [];

		if (spec.selectorKey) {
			const loaderRef = resolveName(ml.t(spec.selectorKey), resolveCtx);
			if (loaderRef.file) {
				entries.push(
					await this.buildEntry(
						"loader",
						loaderRef,
						usage,
						spec,
						ioto,
						ml,
						resolveCtx,
						switcherCache,
						warnings,
					),
				);
			}
		}

		// 热键入口按 `** for:` 归组，不再按当前分类预过滤。
		for (const item of hotkeys) {
			if (USAGE_BY_FOR[item.header.for ?? ""] !== usage) continue;
			if (
				entries.some(
					(entry) => entry.selector.file?.path === item.file.path,
				)
			) {
				continue;
			}
			entries.push(
				await this.buildEntry(
					"hotkey",
					{
						name: item.file.basename,
						file: item.file,
						via: "direct",
						candidates: [item.file.basename],
					},
					usage,
					spec,
					ioto,
					ml,
					resolveCtx,
					switcherCache,
					warnings,
				),
			);
		}

		if (entries.length === 0 && spec.selectorKey) {
			warnings.push(`selector-missing:${usage}`);
		}

		const bindingGroups = this.aggregateBindings(entries);
		const single = bindingGroups.length === 1 ? bindingGroups[0] : null;
		const singleSwitcher = single?.kind === "switcher" ? single : null;

		const taskSlots =
			usage === "Task" ? this.buildTaskSlots(ml, resolveCtx) : undefined;
		const taskBranches =
			usage === "Task" ? this.buildTaskBranches(entries) : undefined;

		return {
			usage,
			entries,
			bindingGroups,
			switcher: singleSwitcher ? singleSwitcher.ref : null,
			pathMode: singleSwitcher ? singleSwitcher.pathMode : false,
			rules: singleSwitcher ? singleSwitcher.rules : [],
			defaultTemplate: singleSwitcher
				? singleSwitcher.defaultTemplate
				: null,
			taskSlots,
			taskBranches,
			error: singleSwitcher ? singleSwitcher.error : null,
		};
	}

	/** 同一分类内按绑定归并；可达数与生效模板都按绑定计算。 */
	private aggregateBindings(entries: EntryGroup[]): BindingGroup[] {
		const groups = new Map<string, BindingGroup>();
		const buckets = new Map<string, EntryGroup[]>();

		for (const entry of entries) {
			const key = bindingKey(entry.binding);
			// 缺省的分组容器必须先建，后两条 entry 才能落到同一组。
			if (!groups.has(key)) {
				const binding = entry.binding;
				groups.set(key, {
					key,
					kind: binding.kind,
					ref:
						binding.kind === "switcher" ||
						binding.kind === "direct-template"
							? binding.ref
							: null,
					rules: binding.kind === "switcher" ? binding.rules : [],
					defaultTemplate:
						binding.kind === "switcher"
							? binding.defaultTemplate
							: null,
					pathMode:
						binding.kind === "switcher" ? binding.pathMode : false,
					error:
						binding.kind === "switcher"
							? binding.parseError
							: binding.kind === "unresolved"
								? binding.reason
								: null,
					forHint:
						binding.kind === "switcher" ? binding.forHint : null,
				});
				buckets.set(key, []);
			}
			buckets.get(key)?.push(entry);
		}

		for (const [key, group] of groups) {
			const members = buckets.get(key) ?? [];
			const reach = new Map<number, number>();
			for (const entry of members) {
				for (const folder of entry.folders) {
					if (folder.ruleIndex === null) continue;
					reach.set(
						folder.ruleIndex,
						(reach.get(folder.ruleIndex) ?? 0) + 1,
					);
				}
			}
			for (const rule of group.rules) {
				rule.reachCount = reach.get(rule.index) ?? 0;
			}
			for (const entry of members) {
				for (const folder of entry.folders) {
					folder.effectiveTemplate = this.effectiveFor(folder, group);
				}
			}
		}

		return Array.from(groups.values());
	}

	private effectiveFor(
		folder: FolderRow,
		group: BindingGroup,
	): FileRef | null {
		if (folder.status === "excluded") return null;
		if (folder.status === "matched" || folder.status === "empty-match") {
			return folder.template;
		}
		if (folder.status === "direct") return group.ref;
		if (folder.status === "no-template") return null;
		return group.defaultTemplate;
	}

	private buildRules(
		parsed: ReturnType<typeof parseSwitcherRules>["rules"],
		resolveCtx: ResolveContext,
	): RuleRow[] {
		const rules: RuleRow[] = parsed.map((rule, index) => {
			const templateName = rule.templateName ?? "";
			return {
				index: index + 1,
				match: rule.match ?? "",
				templateRaw: rule.templateRaw ?? "",
				templateName,
				template: templateName
					? resolveName(templateName, resolveCtx)
					: this.emptyRef(templateName),
				emptyMatch: (rule.match ?? "") === "",
				duplicateOf: null,
				shadowedBy: null,
				reachCount: 0,
				unresolved: rule.unresolved,
			};
		});

		rules.forEach((rule, index) => {
			for (let previous = 0; previous < index; previous++) {
				const other = rules[previous];
				if (!other) continue;
				if (rule.duplicateOf === null && other.match === rule.match) {
					rule.duplicateOf = other.index;
				}
			}
			if (rule.duplicateOf !== null) return;
			for (let previous = 0; previous < index; previous++) {
				const other = rules[previous];
				if (!other) continue;
				if (rule.match.includes(other.match)) {
					rule.shadowedBy = other.index;
					break;
				}
			}
		});

		return rules;
	}

	private emptyRef(name: string): FileRef {
		return { name, file: null, via: "plain", candidates: name ? [name] : [] };
	}

	/** 热键清单只扫一次；分类归属交给调用方按 `for:` 判定。 */
	private async collectHotkeySelectors(
		warnings: string[],
	): Promise<HotkeyScan> {
		const entries: HotkeySelector[] = [];
		const brokenPaths: string[] = [];
		const paths = await this.getHotkeyPaths(warnings);
		if (!paths) return { entries, brokenPaths };

		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(
				normalizePath(path),
			);
			if (!(file instanceof TFile) || file.extension !== "md") {
				brokenPaths.push(path);
				continue;
			}
			const text = (await this.readText(file.path)) ?? "";
			const header = parseHeader(text);
			if (header.type !== "selector") continue;
			if (header.for && !USAGE_BY_FOR[header.for]) {
				warnings.push(`selector-for-unknown:${file.basename}`);
				continue;
			}
			entries.push({ file, header });
		}

		return { entries, brokenPaths };
	}

	private async buildEntry(
		source: "loader" | "hotkey",
		selector: FileRef,
		usage: Usage,
		spec: { selectorKey: string | null; switcherKey: string | null; noteKey: string },
		ioto: IotoSettings,
		ml: Ml,
		resolveCtx: ResolveContext,
		switcherCache: Map<string, CachedSwitcher>,
		warnings: string[],
	): Promise<EntryGroup> {
		const emptySettings: FolderSettings = {
			baseFolder: "",
			showSubFolders: false,
			includeParentFolder: false,
			matchMode: "fuzzy",
			excludeRules: [],
			contextNote: null,
			error: "selector-unreadable",
		};

		if (!selector.file) {
			return {
				source,
				selector,
				folderSettings: emptySettings,
				binding: { kind: "none" },
				folders: [],
			};
		}

		const text = await this.readText(selector.file.path);
		if (text === null) {
			return {
				source,
				selector,
				folderSettings: emptySettings,
				binding: { kind: "none" },
				folders: [],
			};
		}

		// 绑定与文件夹配置互不依赖：配置解析失败时也要看得见条目绑定。
		const binding = await this.resolveBinding(
			text,
			spec,
			ml,
			resolveCtx,
			switcherCache,
		);

		const parsed = parseFolderSettings(text, { ...ioto });
		if (!parsed.value || parsed.error) {
			return {
				source,
				selector,
				folderSettings: { ...emptySettings, error: parsed.error },
				binding,
				folders: [],
			};
		}

		const value = parsed.value;
		const rawPath = value.folderPath;
		let baseFolder = (typeof rawPath === "string" ? rawPath : "").replace(
			/\/+$/,
			"",
		);
		let contextNote: string | null = null;

		if (usage === "Outcome") {
			const resolved = await this.resolveOutcomeBase(baseFolder, ioto);
			baseFolder = resolved.baseFolder;
			contextNote = resolved.contextNote;
		}

		const rawExcludes = value.excludesPaths;
		const excludeText = Array.isArray(rawExcludes)
			? rawExcludes.map(String).join("\n")
			: typeof rawExcludes === "string"
				? rawExcludes
				: "";
		const excludeRules = splitExcludeRules(excludeText);

		const showSubFolders = Boolean(value.showSubFolders);
		const includeParentFolder = Boolean(value.includeParentFolder);
		const matchMode: "segment" | "fuzzy" = includeParentFolder
			? "segment"
			: "fuzzy";

		const folderSettings: FolderSettings = {
			baseFolder,
			showSubFolders,
			includeParentFolder,
			matchMode,
			excludeRules,
			contextNote,
			error: null,
		};

		const list = this.listFolders(baseFolder, showSubFolders, includeParentFolder);
		if (list.length === 0) {
			folderSettings.error = "base-folder-not-found";
			warnings.push(`base-folder-missing:${baseFolder}`);
		}

		// Task 只画规则表与模板槽，不画文件夹树。
		if (usage === "Task") {
			return { source, selector, folderSettings, binding, folders: [] };
		}

		const folders: FolderRow[] = list.map((folder) =>
			this.buildFolderRow(folder, baseFolder, folderSettings, binding),
		);

		return { source, selector, folderSettings, binding, folders };
	}

	/** 读选择器的 `noteSettings.template`，再按目标文件身份分派四种绑定形态。 */
	private async resolveBinding(
		content: string,
		spec: { noteKey: string },
		ml: Ml,
		resolveCtx: ResolveContext,
		switcherCache: Map<string, CachedSwitcher>,
	): Promise<SwitcherBinding> {
		const parsed = parseSelectorBinding(content, ml);
		if (parsed.kind === "none") return { kind: "none" };
		if (parsed.kind === "unresolved") {
			return { kind: "unresolved", raw: parsed.raw, reason: parsed.reason };
		}

		const ref = resolveName(parsed.name, resolveCtx);
		if (!ref.file) {
			// 名字解析不到时保留红色名字，绝不假装成直连模板。
			return {
				kind: "switcher",
				ref,
				rules: [],
				defaultTemplate: null,
				pathMode: false,
				forHint: null,
				parseError: "target-missing",
			};
		}

		const cached = await this.loadSwitcher(
			ref.file.path,
			ml,
			resolveCtx,
			switcherCache,
		);
		if (cached.type !== "switcher") {
			return { kind: "direct-template", ref };
		}

		const defaultName = cached.defaultTemplateName ?? ml.t(spec.noteKey);
		return {
			kind: "switcher",
			ref,
			rules: cached.rules,
			defaultTemplate: resolveName(defaultName, resolveCtx),
			pathMode: cached.pathMode,
			forHint: cached.forHint,
			parseError: cached.error,
		};
	}

	/** 同一切换器只解析一次：规则数组按路径共享，reach 按绑定分组统计。 */
	private async loadSwitcher(
		path: string,
		ml: Ml,
		resolveCtx: ResolveContext,
		cache: Map<string, CachedSwitcher>,
	): Promise<CachedSwitcher> {
		const cached = cache.get(path);
		if (cached) return cached;

		const text = (await this.readText(path)) ?? "";
		const header = parseHeader(text);

		if (header.type !== "switcher") {
			const entry: CachedSwitcher = {
				type: header.type,
				rules: [],
				pathMode: false,
				defaultTemplateName: null,
				forHint: header.for,
				error: null,
			};
			cache.set(path, entry);
			return entry;
		}

		const parsed = parseSwitcherRules(text, ml);
		const entry: CachedSwitcher = {
			type: header.type,
			rules: this.buildRules(parsed.rules, resolveCtx),
			pathMode: parsed.pathMode,
			defaultTemplateName: parsed.defaultTemplateName,
			forHint: header.for,
			error: parsed.error,
		};
		cache.set(path, entry);
		return entry;
	}

	/**
	 * 文件夹行只依赖「该条目自己的绑定」；规则表由切换器解析得到，
	 * 这里用同一个 resolve 结果重建，避免把规则对象跨入口共享后被 reachCount 污染。
	 */
	private buildFolderRow(
		folder: TFolder,
		baseFolder: string,
		settings: FolderSettings,
		binding: SwitcherBinding,
	): FolderRow {
		const visibility = folderVisible(
			folder.path,
			settings.excludeRules,
			settings.matchMode,
		);

		const baseSegments = baseFolder.split("/").filter(Boolean).length;
		const depth = Math.max(
			0,
			folder.path.split("/").filter(Boolean).length - baseSegments,
		);

		const common = {
			path: folder.path,
			name: folder.name,
			depth,
			effectiveTemplate: null,
			excludedBy: visibility.excludedBy,
		};

		// 直连模板 / 空绑定没有规则可命中，状态由绑定种类直接决定。
		if (binding.kind !== "switcher") {
			return {
				...common,
				status: visibility.visible
					? binding.kind === "direct-template"
						? "direct"
						: "no-template"
					: "excluded",
				ruleIndex: null,
				match: null,
				template:
					binding.kind === "direct-template" ? binding.ref : null,
			};
		}

		const prefix = folderPrefix(folder.path, binding.pathMode);
		const picked = pickRule(prefix, binding.rules);
		// FolderRow.ruleIndex 与 RuleRow.index 一样是 1 起，视图直接显示。
		const ruleIndex = picked === null ? null : picked + 1;
		const rule = picked === null ? null : (binding.rules[picked] ?? null);

		const status = classify({
			excluded: !visibility.visible,
			ruleIndex,
			match: rule?.match ?? null,
			hasTemplate: Boolean(rule?.template.file),
		});

		return {
			...common,
			status,
			ruleIndex,
			match: rule?.match ?? null,
			template: rule?.template ?? null,
		};
	}

	private listFolders(
		basePath: string,
		showSubFolders: boolean,
		includeParentFolder: boolean,
	): TFolder[] {
		if (!basePath) return [];
		const base = this.app.vault.getAbstractFileByPath(normalizePath(basePath));
		if (!(base instanceof TFolder)) return [];

		if (!showSubFolders) return [base];

		const folders: TFolder[] = [];
		const walk = (parent: TFolder) => {
			for (const child of parent.children) {
				if (child instanceof TFolder) {
					folders.push(child);
					walk(child);
				}
			}
		};
		walk(base);
		folders.sort((a, b) => a.path.localeCompare(b.path));
		if (includeParentFolder) folders.unshift(base);
		return folders;
	}

	private async resolveOutcomeBase(
		baseFolder: string,
		ioto: IotoSettings,
	): Promise<{ baseFolder: string; contextNote: string }> {
		const outcomeFolder =
			baseFolder || String(ioto.outcomeFolder || "").replace(/\/+$/, "");
		const taskFolder = String(ioto.taskFolder || "").replace(/\/+$/, "");
		const active = this.app.workspace.getActiveFile();
		const parentPath = active?.parent?.path ?? "";
		if (!parentPath) {
			return { baseFolder: outcomeFolder, contextNote: "default" };
		}

		const project = this.readProject(active);
		const firstSegment = parentPath.split("/")[1] ?? "";
		const insideTaskOrOutcome =
			isPathUnder(parentPath, taskFolder) ||
			isPathUnder(parentPath, outcomeFolder);
		const notTaskRoot = parentPath !== taskFolder;

		if (insideTaskOrOutcome && notTaskRoot && firstSegment) {
			return {
				baseFolder: `${outcomeFolder}/${firstSegment}`,
				contextNote: `active:${parentPath}`,
			};
		}

		if (
			project &&
			this.app.vault.getAbstractFileByPath(
				normalizePath(`${outcomeFolder}/${project}`),
			)
		) {
			return {
				baseFolder: `${outcomeFolder}/${project}`,
				contextNote: `active:${parentPath}`,
			};
		}

		return { baseFolder: outcomeFolder, contextNote: "default" };
	}

	private readProject(file: TFile | null): string | null {
		if (!file) return null;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const project: unknown = frontmatter?.Project;
		if (typeof project === "string" && project.trim()) return project.trim();
		if (Array.isArray(project) && typeof project[0] === "string") {
			return project[0];
		}
		return null;
	}

	private buildTaskSlots(ml: Ml, resolveCtx: ResolveContext): TaskSlot[] {
		const slots: { key: string; labelKey: string; templateKey: string }[] = [
			{
				key: "note",
				labelKey: "CreateDateTask",
				templateKey: "IOTODefaultTaskNoteTemplate",
			},
			{
				key: "subject",
				labelKey: "CreateSubjectTask",
				templateKey: "IOTODefaultSubjectNoteTemplate",
			},
			{
				key: "plan",
				labelKey: "CreatePlanTask",
				templateKey: "IOTODefaultPlanNoteTemplate",
			},
			{
				key: "normal",
				labelKey: "CreateNormalTask",
				templateKey: "IOTODefaultNormalNoteTemplate",
			},
		];

		return slots.map((slot) => ({
			key: slot.key,
			label: ml.t(slot.labelKey),
			template: resolveName(ml.t(slot.templateKey), resolveCtx),
		}));
	}

	private buildTaskBranches(entries: EntryGroup[]): TaskBranch[] {
		const active = this.app.workspace.getActiveFile();
		const activeParent = active?.parent?.path ?? "";
		const base = entries[0]?.folderSettings.baseFolder ?? "";

		return [
			{
				name: "subTask",
				condition: "MAP_BRANCH_SUBTASK",
				baseFolder: activeParent,
			},
			{
				name: "currentProject",
				condition: "MAP_BRANCH_CURRENT_PROJECT",
				baseFolder: activeParent,
			},
			{
				name: "otherProject",
				condition: "MAP_BRANCH_OTHER_PROJECT",
				baseFolder: base,
			},
		];
	}

	private async getHotkeyPaths(warnings: string[]): Promise<string[] | null> {
		const templater = this.app.plugins.plugins["templater-obsidian"] as
			| { settings?: { enabled_templates_hotkeys?: unknown } }
			| undefined;
		const fromSettings = templater?.settings?.enabled_templates_hotkeys;
		if (Array.isArray(fromSettings)) {
			return fromSettings.filter(
				(path): path is string => typeof path === "string",
			);
		}

		// 配置目录可能被用户改名，不能用硬编码的 .obsidian。
		const text = await this.readText(
			`${this.app.vault.configDir}/plugins/templater-obsidian/data.json`,
		);
		if (!text) {
			warnings.push("hotkeys-unavailable");
			return null;
		}
		try {
			const data = JSON.parse(text) as {
				enabled_templates_hotkeys?: unknown;
			};
			if (!Array.isArray(data.enabled_templates_hotkeys)) {
				return null;
			}
			return data.enabled_templates_hotkeys.filter(
				(path): path is string => typeof path === "string",
			);
		} catch {
			warnings.push("hotkeys-unavailable");
			return null;
		}
	}

	/** 未被任何入口挂载的选择器/切换器，外加失效的热键路径。 */
	private async collectUnmounted(
		categories: CategoryMap[],
		hotkeys: HotkeyScan,
		warnings: string[],
	): Promise<UnmountedRow[]> {
		const usedSelectors = new Set<string>();
		const usedSwitchers = new Set<string>();

		for (const category of categories) {
			for (const entry of category.entries) {
				if (entry.selector.file) usedSelectors.add(entry.selector.file.path);
				const binding = entry.binding;
				if (binding.kind === "switcher" && binding.ref.file) {
					usedSwitchers.add(binding.ref.file.path);
				}
			}
		}
		// 热键挂载即「已使用」，即使它的 `for:` 解析不出分类。
		for (const item of hotkeys.entries) usedSelectors.add(item.file.path);

		const rows: UnmountedRow[] = [];

		const collect = async (
			root: string,
			type: "selector" | "switcher",
		): Promise<void> => {
			if (!root) return;
			const used = type === "selector" ? usedSelectors : usedSwitchers;

			for (const file of this.listMarkdownFiles(root)) {
				const text = (await this.readText(file.path)) ?? "";
				const header = parseHeader(text);
				if (header.type !== type) continue;
				if (used.has(file.path)) continue;
				rows.push({
					type,
					name: file.basename,
					path: file.path,
					file,
					for: header.for,
					reason: type === "selector" ? "no-hotkey" : "no-selector",
				});
			}
		};

		await collect(
			String(this.plugin.settings.selectorFolderPath || ""),
			"selector",
		);
		await collect(
			String(this.plugin.settings.switcherFolderPath || ""),
			"switcher",
		);

		for (const path of hotkeys.brokenPaths) {
			const segments = path.split("/");
			rows.push({
				type: "unknown",
				name: segments[segments.length - 1] ?? path,
				path,
				file: null,
				for: null,
				reason: "hotkey-missing",
			});
		}

		rows.sort((a, b) => {
			if (a.type !== b.type) return a.type.localeCompare(b.type);
			return a.path.localeCompare(b.path);
		});
		if (rows.length > 0) warnings.push(`unmounted:${rows.length}`);

		return rows;
	}

	private listMarkdownFiles(root: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(normalizePath(root));
		if (!(folder instanceof TFolder)) return [];

		const files: TFile[] = [];
		const walk = (parent: TFolder) => {
			for (const child of parent.children) {
				if (child instanceof TFolder) {
					walk(child);
					continue;
				}
				if (child instanceof TFile && child.extension === "md") {
					files.push(child);
				}
			}
		};
		walk(folder);
		return files.sort((a, b) => a.path.localeCompare(b.path));
	}

	// —— 反向索引与孤儿 ——

	private buildReverseIndex(categories: CategoryMap[]): ReverseIndexRow[] {
		const map = new Map<
			string,
			{
				template: TFile;
				refs: { usage: Usage; ruleIndex: number | null; folderCount: number }[];
			}
		>();

		const add = (
			ref: FileRef | null,
			usage: Usage,
			ruleIndex: number | null,
			folderCount: number,
		) => {
			if (!ref?.file) return;
			const existing = map.get(ref.file.path) ?? {
				template: ref.file,
				refs: [],
			};
			// 默认模板与任务模板槽可能指向同一文件，同一引用只记一次。
			const duplicated = existing.refs.some(
				(item) => item.usage === usage && item.ruleIndex === ruleIndex,
			);
			if (!duplicated) {
				existing.refs.push({ usage, ruleIndex, folderCount });
			}
			map.set(ref.file.path, existing);
		};

		for (const category of categories) {
			const visible = new Map<string, number>();
			for (const entry of category.entries) {
				const key = bindingKey(entry.binding);
				const count = entry.folders.filter(
					(folder) => folder.status !== "excluded",
				).length;
				visible.set(key, (visible.get(key) ?? 0) + count);
			}

			for (const group of category.bindingGroups) {
				if (group.kind === "switcher") {
					for (const rule of group.rules) {
						add(
							rule.template,
							category.usage,
							rule.index,
							rule.reachCount,
						);
					}
					add(group.defaultTemplate, category.usage, null, 0);
				} else if (group.kind === "direct-template") {
					add(
						group.ref,
						category.usage,
						null,
						visible.get(group.key) ?? 0,
					);
				}
			}
			for (const slot of category.taskSlots ?? []) {
				add(slot.template, category.usage, null, 0);
			}
		}

		return Array.from(map.values()).sort((a, b) => {
			const sumA = a.refs.reduce((sum, ref) => sum + ref.folderCount, 0);
			const sumB = b.refs.reduce((sum, ref) => sum + ref.folderCount, 0);
			if (sumA !== sumB) return sumB - sumA;
			return a.template.path.localeCompare(b.template.path);
		});
	}

	private buildOrphans(
		categories: CategoryMap[],
		warnings: string[],
	): TemplateMapModel["orphans"] {
		const missingTargets: TemplateMapModel["orphans"]["missingTargets"] = [];
		const referenced = new Set<string>();
		const seenMissing = new Set<string>();

		const addMissing = (
			usage: Usage,
			ruleIndex: number | null,
			name: string,
			source: "rule" | "default" | "binding",
		) => {
			const key = `${usage}|${ruleIndex}|${name}|${source}`;
			if (seenMissing.has(key)) return;
			seenMissing.add(key);
			missingTargets.push({ usage, ruleIndex, name, source });
		};

		for (const category of categories) {
			for (const group of category.bindingGroups) {
				if (group.kind === "switcher") {
					if (group.error === "target-missing" && group.ref) {
						addMissing(category.usage, null, group.ref.name, "binding");
					}
					if (group.defaultTemplate?.file) {
						referenced.add(group.defaultTemplate.file.path);
					} else if (group.defaultTemplate) {
						addMissing(
							category.usage,
							null,
							group.defaultTemplate.name,
							"default",
						);
					}
					for (const rule of group.rules) {
						if (rule.template.file) {
							referenced.add(rule.template.file.path);
						} else if (rule.templateName) {
							addMissing(
								category.usage,
								rule.index,
								rule.templateName,
								"rule",
							);
						}
					}
				} else if (group.kind === "direct-template" && group.ref?.file) {
					referenced.add(group.ref.file.path);
				}
			}
			for (const slot of category.taskSlots ?? []) {
				if (slot.template.file) referenced.add(slot.template.file.path);
			}
		}

		const folderPath = String(this.plugin.settings.noteTemplatesFolderPath || "");
		const unreferenced: TFile[] = [];
		if (!folderPath) {
			warnings.push("note-templates-folder-unset");
			return { missingTargets, unreferencedTemplates: unreferenced };
		}

		const folder = this.app.vault.getAbstractFileByPath(
			normalizePath(folderPath),
		);
		if (!(folder instanceof TFolder)) {
			warnings.push("note-templates-folder-missing");
			return { missingTargets, unreferencedTemplates: unreferenced };
		}

		for (const file of this.listMarkdownFiles(folder.path)) {
			if (!referenced.has(file.path)) unreferenced.push(file);
		}
		unreferenced.sort((a, b) => a.path.localeCompare(b.path));

		return { missingTargets, unreferencedTemplates: unreferenced };
	}
}
