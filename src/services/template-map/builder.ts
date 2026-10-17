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
import { parseFolderSettings, parseSwitcherRules } from "./parser";
import {
	CATEGORY_ORDER,
	CategoryMap,
	EntryGroup,
	FileRef,
	FolderRow,
	FolderSettings,
	ReverseIndexRow,
	RuleRow,
	TaskBranch,
	TaskSlot,
	TemplateMapModel,
} from "./types";

interface ContentCacheEntry {
	mtime: number;
	text: string;
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

		const categories: CategoryMap[] = [];
		for (const usage of CATEGORY_ORDER) {
			categories.push(
				await this.buildCategory(
					usage,
					ioto,
					runtime.ml,
					resolveCtx,
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
		warnings: string[],
	): Promise<CategoryMap> {
		const switcherName = ml.t(`IOTODefault${usage}SwitcherTemplate`);
		const switcher = resolveName(switcherName, resolveCtx);

		if (!switcher.file) {
			warnings.push(`switcher-missing:${usage}`);
			return {
				usage,
				entries: [],
				switcher,
				pathMode: false,
				rules: [],
				defaultTemplate: null,
				error: "switcher-missing",
			};
		}

		const switcherText = (await this.readText(switcher.file.path)) ?? "";
		const parsed = parseSwitcherRules(switcherText, ml);

		const defaultName =
			parsed.defaultTemplateName ??
			ml.t(`IOTODefault${usage}NoteTemplate`);
		const defaultTemplate = resolveName(defaultName, resolveCtx);

		const rules = this.buildRules(parsed.rules, resolveCtx);

		const entries = await this.buildEntries(
			usage,
			ioto,
			parsed,
			ml,
			rules,
			warnings,
		);

		const taskSlots =
			usage === "Task" ? this.buildTaskSlots(ml, resolveCtx) : undefined;
		const taskBranches =
			usage === "Task" ? this.buildTaskBranches(entries) : undefined;

		// reachCount 要等文件夹枚举完成，跨入口统一统计。
		const reach = new Map<number, number>();
		for (const entry of entries) {
			for (const folder of entry.folders) {
				if (folder.ruleIndex === null) continue;
				reach.set(folder.ruleIndex, (reach.get(folder.ruleIndex) ?? 0) + 1);
			}
			for (const folder of entry.folders) {
				folder.effectiveTemplate = this.pickEffective(
					folder,
					defaultTemplate,
				);
			}
		}
		for (const rule of rules) {
			rule.reachCount = reach.get(rule.index) ?? 0;
		}

		return {
			usage,
			entries,
			switcher,
			pathMode: parsed.pathMode,
			rules,
			defaultTemplate,
			taskSlots,
			taskBranches,
			error: parsed.error,
		};
	}

	private pickEffective(
		folder: FolderRow,
		defaultTemplate: FileRef,
	): FileRef | null {
		if (folder.status === "excluded") return null;
		if (folder.status === "matched" || folder.status === "empty-match") {
			return folder.template;
		}
		return defaultTemplate;
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

	private async buildEntries(
		usage: Usage,
		ioto: IotoSettings,
		parsed: ReturnType<typeof parseSwitcherRules>,
		ml: Ml,
		rules: RuleRow[],
		warnings: string[],
	): Promise<EntryGroup[]> {
		const resolveCtx: ResolveContext = {
			prefix: String(ioto.userTemplatePrefix || "My"),
			useUserTemplate: ioto.useUserTemplate !== false,
			lookup: (name) => this.lookup(name),
		};

		const entries: EntryGroup[] = [];

		const loaderName = ml.t(`IOTODefault${usage}Selector`);
		const loaderRef = resolveName(loaderName, resolveCtx);
		if (loaderRef.file) {
			entries.push(
				await this.buildEntry(
					"loader",
					loaderRef,
					usage,
					ioto,
					parsed.pathMode,
					rules,
					warnings,
				),
			);
		}

		const hotkeyPaths = await this.getHotkeyPaths(warnings);
		if (hotkeyPaths) {
			for (const path of hotkeyPaths) {
				const file = this.app.vault.getAbstractFileByPath(
					normalizePath(path),
				);
				if (!(file instanceof TFile) || file.extension !== "md") continue;
				if (loaderRef.file && file.path === loaderRef.file.path) continue;

				const text = (await this.readText(file.path)) ?? "";
				if (!/\*\*\s*type:\s*selector\b/i.test(text)) continue;
				const forMatch = /\*\*\s*for:\s*([A-Za-z]+)/i.exec(text);
				if (
					!forMatch?.[1] ||
					forMatch[1].toLowerCase() !== usage.toLowerCase()
				) {
					continue;
				}

				entries.push(
					await this.buildEntry(
						"hotkey",
						{
							name: file.basename,
							file,
							via: "direct",
							candidates: [file.basename],
						},
						usage,
						ioto,
						parsed.pathMode,
						rules,
						warnings,
					),
				);
			}
		}

		// 没有 loader 入口时，至少把切换器本身画出来，便于排错。
		if (entries.length === 0) {
			warnings.push(`selector-missing:${usage}`);
		}

		return entries;
	}

	private async buildEntry(
		source: "loader" | "hotkey",
		selector: FileRef,
		usage: Usage,
		ioto: IotoSettings,
		pathMode: boolean,
		rules: RuleRow[],
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
			return { source, selector, folderSettings: emptySettings, folders: [] };
		}

		const text = await this.readText(selector.file.path);
		if (!text) {
			return { source, selector, folderSettings: emptySettings, folders: [] };
		}

		const parsed = parseFolderSettings(text, { ...ioto });
		if (!parsed.value || parsed.error) {
			return {
				source,
				selector,
				folderSettings: { ...emptySettings, error: parsed.error },
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
			return { source, selector, folderSettings, folders: [] };
		}

		const folders: FolderRow[] = list.map((folder) =>
			this.buildFolderRow(
				folder,
				baseFolder,
				folderSettings,
				rules,
				pathMode,
			),
		);

		return { source, selector, folderSettings, folders };
	}

	/**
	 * 文件夹行只依赖「规则表」，而规则表由切换器解析得到；
	 * 这里用同一个 resolve 结果重建，避免把规则对象跨入口共享后被 reachCount 污染。
	 */
	private buildFolderRow(
		folder: TFolder,
		baseFolder: string,
		settings: FolderSettings,
		rules: RuleRow[],
		pathMode: boolean,
	): FolderRow {
		const prefix = folderPrefix(folder.path, pathMode);
		const picked = pickRule(prefix, rules);
		// FolderRow.ruleIndex 与 RuleRow.index 一样是 1 起，视图直接显示。
		const ruleIndex = picked === null ? null : picked + 1;
		const rule = picked === null ? null : (rules[picked] ?? null);
		const visibility = folderVisible(
			folder.path,
			settings.excludeRules,
			settings.matchMode,
		);

		const status = classify({
			excluded: !visibility.visible,
			ruleIndex,
			match: rule?.match ?? null,
			hasTemplate: Boolean(rule?.template.file),
		});

		const baseSegments = baseFolder.split("/").filter(Boolean).length;
		const depth = Math.max(
			0,
			folder.path.split("/").filter(Boolean).length - baseSegments,
		);

		return {
			path: folder.path,
			name: folder.name,
			depth,
			status,
			ruleIndex,
			match: rule?.match ?? null,
			template: rule?.template ?? null,
			effectiveTemplate: null,
			excludedBy: visibility.excludedBy,
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
			add(category.defaultTemplate, category.usage, null, 0);
			for (const rule of category.rules) {
				add(rule.template, category.usage, rule.index, rule.reachCount);
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

		for (const category of categories) {
			if (category.defaultTemplate?.file) {
				referenced.add(category.defaultTemplate.file.path);
			}
			for (const rule of category.rules) {
				if (rule.template.file) {
					referenced.add(rule.template.file.path);
				} else if (rule.templateName) {
					missingTargets.push({
						usage: category.usage,
						ruleIndex: rule.index,
						name: rule.templateName,
					});
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

		const walk = (parent: TFolder) => {
			for (const child of parent.children) {
				if (child instanceof TFolder) {
					walk(child);
					continue;
				}
				if (child instanceof TFile && child.extension === "md") {
					if (!referenced.has(child.path)) unreferenced.push(child);
				}
			}
		};
		walk(folder);
		unreferenced.sort((a, b) => a.path.localeCompare(b.path));

		return { missingTargets, unreferencedTemplates: unreferenced };
	}
}
