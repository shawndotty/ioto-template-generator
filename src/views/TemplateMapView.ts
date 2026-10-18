import {
	EventRef,
	ItemView,
	Notice,
	TAbstractFile,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
	setIcon,
} from "obsidian";
import { MAP_VIEW_TYPE } from "../models/constants";
import { t } from "../lang/helpers";
import type IOTOTemplateGeneratorPlugin from "../main";
import { TemplateMapBuilder } from "../services/template-map/builder";
import { isPathUnder } from "../services/template-map/resolver";
import {
	CategoryMap,
	EntryGroup,
	FileRef,
	FolderRow,
	FolderSettings,
	FolderStatus,
	OutcomeScope,
	OutcomeScopeInfo,
	ReverseIndexRow,
	RuleRow,
	TemplateMapModel,
	UnmountedRow,
	USAGE_BY_FOR,
} from "../services/template-map/types";

type TranslationKey = Parameters<typeof t>[0];

/** 行级编辑目标：切换器文件 + 该行所属规则（默认模板行为 null）。 */
type EditTarget = {
	switcherFile: TFile | null;
	rule: RuleRow | null;
};

/** 条目级：切换器 + 规则索引表；本行规则由 renderFolderRow 按 ruleIndex 查。 */
type EditSource = {
	switcherFile: TFile | null;
	ruleByIndex: Map<number, RuleRow>;
};

/** 地图的两种呈现：详情版（全量信息）/ 极简版（只看文件夹与模板）。 */
type MapMode = "detail" | "minimal";
const DEFAULT_MAP_MODE: MapMode = "minimal";

const STATUS_KEY: Record<FolderStatus, TranslationKey> = {
	matched: "MAP_STATUS_MATCHED",
	"matched-missing": "MAP_STATUS_MATCHED_MISSING",
	fallback: "MAP_STATUS_FALLBACK",
	excluded: "MAP_STATUS_EXCLUDED",
	"empty-match": "MAP_STATUS_EMPTY_MATCH",
	direct: "MAP_STATUS_DIRECT",
	"no-template": "MAP_STATUS_NO_TEMPLATE",
};

const UNMOUNTED_TYPE_KEY: Record<UnmountedRow["type"], TranslationKey> = {
	selector: "MAP_UNMOUNTED_TYPE_SELECTOR",
	switcher: "MAP_UNMOUNTED_TYPE_SWITCHER",
	unknown: "MAP_UNMOUNTED_TYPE_UNKNOWN",
};

const UNMOUNTED_REASON_KEY: Record<UnmountedRow["reason"], TranslationKey> = {
	"no-hotkey": "MAP_UNMOUNTED_REASON_NO_HOTKEY",
	"no-selector": "MAP_UNMOUNTED_REASON_NO_SELECTOR",
	"hotkey-missing": "MAP_UNMOUNTED_REASON_HOTKEY_MISSING",
};

/**
 * 只读视图：渲染 `TemplateMapModel`，不做任何写回。
 * 解析全部在 builder 里完成，这里只负责 DOM。
 */
export class TemplateMapView extends ItemView {
	private builder: TemplateMapBuilder;
	private eventRefs: EventRef[] = [];
	private scheduleRebuild: () => void;
	private loading = false;
	private collapsed = new Set<string>();
	private expanded = new Set<string>();
	/** 条目配置注脚的展开态；key 为 `${usage}:${index}`，render() 之间保留。 */
	private footnoteState = new Map<string, boolean>();
	/** 成果范围按成果根存放：不同根各自独立。只在视图实例内，关视图即回默认。 */
	private outcomeScopes = new Map<string, OutcomeScope>();
	private mode: MapMode = DEFAULT_MAP_MODE;
	/** 上一次 build 的结果：Tab 切换只重画 body，不重扫 vault。 */
	private model: TemplateMapModel | null = null;
	/** body 容器：header 只在 render() 里建一次。 */
	private bodyEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: IOTOTemplateGeneratorPlugin,
	) {
		super(leaf);
		this.builder = new TemplateMapBuilder(this.app, plugin);
		this.scheduleRebuild = debounce(
			() => {
				void this.render();
			},
			500,
			true,
		);
	}

	getViewType(): string {
		return MAP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("MAP_VIEW_TITLE");
	}

	getIcon(): string {
		return "map";
	}

	getState(): Record<string, unknown> {
		return { mode: this.mode };
	}

	async setState(state: unknown): Promise<void> {
		const mode = (state as { mode?: string } | null)?.mode;
		if (mode !== "detail" && mode !== "minimal") return;
		if (mode === this.mode) return;
		this.mode = mode;
		// setState 可能在 onOpen 之后被工作区调用：已有 body 就立刻重画。
		if (this.bodyEl) {
			this.syncModeButtons();
			this.renderBody(true);
		}
	}

	/** header 只建一次，模式变化后要把分段控件的选中态跟上。 */
	private syncModeButtons(): void {
		for (const el of Array.from(
			this.contentEl.querySelectorAll<HTMLElement>(
				".ioto-template-map-mode-btn",
			),
		)) {
			const active = el.dataset.mode === this.mode;
			el.toggleClass("is-active", active);
			el.setAttribute("aria-selected", String(active));
		}
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("ioto-template-map-container");
		this.registerVaultEvents();
		await this.render();
	}

	async onClose(): Promise<void> {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
	}

	private registerVaultEvents(): void {
		const onStructure = (file: TAbstractFile) => {
			if (file instanceof TFolder || this.isRelevant(file.path)) {
				this.scheduleRebuild();
			}
		};

		this.eventRefs.push(this.app.vault.on("create", onStructure));
		this.eventRefs.push(this.app.vault.on("delete", onStructure));
		this.eventRefs.push(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				if (
					file instanceof TFolder ||
					this.isRelevant(file.path) ||
					this.isRelevant(oldPath)
				) {
					this.scheduleRebuild();
				}
			}),
		);
		this.eventRefs.push(
			this.app.vault.on("modify", (file: TAbstractFile) => {
				if (this.isRelevant(file.path)) this.scheduleRebuild();
			}),
		);
	}

	private isRelevant(path: string): boolean {
		const settings = this.plugin.settings;
		const roots = [
			settings.selectorFolderPath,
			settings.switcherFolderPath,
			settings.noteTemplatesFolderPath,
		].filter((root): root is string => Boolean(root));
		return roots.some((root) => isPathUnder(path, root));
	}

	private async render(): Promise<void> {
		if (this.loading) return;
		this.loading = true;

		// empty() 会把滚动位置打回顶部，必须在它们之前取值。
		const scrollTop = this.contentEl.scrollTop;
		const container = this.contentEl;
		container.empty();
		container.addClass("ioto-template-map-container");

		try {
			const model = await this.builder.build({
				outcomeScopes: this.outcomeScopes,
			});
			this.model = model;
			container.empty();
			this.renderHeader(container, model);
			this.bodyEl = container.createDiv({
				cls: "ioto-template-map-body",
			});
			this.renderBody(false, scrollTop);
		} catch (error) {
			this.model = null;
			this.bodyEl = null;
			container.empty();
			const card = container.createDiv({
				cls: "ioto-template-map-card ioto-template-map-error",
			});
			card.createEl("pre", {
				text: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.loading = false;
		}
	}

	/** 只重画 body：模式切换 / 折叠展开都走这里，不重扫 vault。 */
	private renderBody(
		resetScroll = false,
		restoreScrollTop?: number,
	): void {
		const model = this.model;
		const body = this.bodyEl;
		if (!model || !body) return;

		const scrollTop = restoreScrollTop ?? this.contentEl.scrollTop;
		body.empty();

		if (model.warnings.includes("no-ioto-settings")) {
			body.createDiv({
				cls: "ioto-template-map-card ioto-template-map-error",
				text: t("MAP_ERROR_NO_SETTINGS"),
			});
			this.contentEl.scrollTop = resetScroll ? 0 : scrollTop;
			return;
		}

		this.renderWarnings(body, model);

		if (model.categories.length === 0) {
			body.createDiv({
				cls: "ioto-template-map-card ioto-template-map-empty",
				text: t("MAP_EMPTY_STATE"),
			});
		} else if (this.mode === "minimal") {
			this.renderMinimal(body, model);
		} else {
			this.renderDetail(body, model);
		}

		this.contentEl.scrollTop = resetScroll ? 0 : scrollTop;
	}

	private renderDetail(
		container: HTMLElement,
		model: TemplateMapModel,
	): void {
		for (const category of model.categories) {
			this.renderCategory(container, model, category);
		}

		this.renderReverseIndex(container, model);
		this.renderOrphans(container, model);
		this.renderUnmounted(container, model.unmounted);
	}

	/** 极简版：只留四类文件夹与模板的对应表，异常的可见性不降级。 */
	private renderMinimal(
		container: HTMLElement,
		model: TemplateMapModel,
	): void {
		const categories = model.categories.filter(
			(category) => category.usage !== "Task",
		);
		if (categories.length === 0) {
			container.createDiv({
				cls: "ioto-template-map-card ioto-template-map-empty",
				text: t("MAP_EMPTY_STATE"),
			});
			return;
		}
		for (const category of categories) {
			this.renderMinimalCategory(container, model, category);
		}
	}

	/** 多入口时优先「切换器且有文件夹」，保证主入口一定有行。 */
	private primaryEntry(category: CategoryMap): EntryGroup | null {
		const entries = category.entries;
		return (
			entries.find(
				(entry) =>
					entry.binding.kind === "switcher" &&
					entry.folders.length > 0,
			) ??
			entries.find((entry) => entry.folders.length > 0) ??
			entries[0] ??
			null
		);
	}

	private renderMinimalCategory(
		container: HTMLElement,
		model: TemplateMapModel,
		category: CategoryMap,
	): void {
		const card = container.createDiv({ cls: "ioto-template-map-card" });
		const head = card.createDiv({ cls: "ioto-template-map-card-head" });

		const headText = head.createDiv({ cls: "ioto-template-map-card-title" });
		headText.createSpan({
			cls: "ioto-template-map-usage",
			text: category.usage === "Custom" ? t("Custom") : category.usage,
		});

		const tools = head.createDiv({ cls: "ioto-template-map-card-tools" });
		if (category.usage === "Outcome") {
			const scopes = this.outcomeScopesOf(category);
			for (const info of scopes) {
				if (scopes.length > 1) {
					tools.createSpan({
						cls: "ioto-template-map-muted",
						text: info.root.split("/").pop() ?? info.root,
					});
				}
				this.renderScopeSelect(tools, info);
			}
		}

		// 折叠态也要答得出当前范围，所以下拉在折叠判断之前建。
		const toggle = tools.createEl("button", {
			cls: "ioto-template-map-icon-btn",
		});
		setIcon(
			toggle,
			this.collapsed.has(category.usage)
				? "chevron-right"
				: "chevron-down",
		);
		toggle.onclick = () => {
			if (this.collapsed.has(category.usage)) {
				this.collapsed.delete(category.usage);
			} else {
				this.collapsed.add(category.usage);
			}
			this.renderBody();
		};

		if (this.collapsed.has(category.usage)) return;

		const body = card.createDiv({ cls: "ioto-template-map-card-body" });

		if (category.error === "switcher-missing") {
			body.createDiv({
				cls: "ioto-template-map-error",
				text: t("MAP_ERROR_SWITCHER_MISSING", {
					name: category.switcher?.name ?? "",
				}),
			});
			return;
		}

		const entry = this.primaryEntry(category);
		if (!entry) {
			body.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_NO_ENTRIES"),
			});
			return;
		}

		if (entry.folders.length === 0) {
			body.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_NO_ENTRIES"),
			});
			return;
		}

		if (category.entries.length > 1) {
			body.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_MINIMAL_MULTI_ENTRY", {
					count: String(category.entries.length),
				}),
			});
		}

		// 异常照常直出；「for 不一致」这类 warn 也不藏。
		for (const issue of this.entryIssues(entry, category)) {
			body.createDiv({
				cls: `ioto-template-map-issue${issue.error ? "" : " is-warn"}`,
				text: issue.text,
			});
		}

		if (entry.folderSettings.error) return;

		if (entry.binding.kind === "unresolved") {
			const line = body.createDiv({ cls: "ioto-template-map-muted" });
			line.createSpan({ text: `${t("MAP_BINDING_UNRESOLVED")}: ` });
			line.createSpan({
				cls: "ioto-template-map-binding-raw",
				text: entry.binding.raw || "—",
			});
			return;
		}

		const table = body.createDiv({
			cls: "ioto-template-map-table is-minimal",
		});
		const headRow = table.createDiv({
			cls: "ioto-template-map-row is-head",
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell",
			text: t("MAP_COL_FOLDER"),
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell",
			text: t("MAP_COL_TEMPLATE"),
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell is-edit",
			text: t("MAP_COL_EDIT"),
		});

		const visible = entry.folders.filter(
			(folder) => folder.status !== "excluded",
		);
		const key = `${category.usage}:${category.entries.indexOf(entry)}`;
		const isExpanded = this.expanded.has(key);
		const limit =
			entry.folderSettings.outcomeScope?.applied === "all" ? 50 : 20;
		const shown =
			isExpanded || visible.length <= limit
				? visible
				: visible.slice(0, limit);

		const source = this.editSourceOf(entry);
		for (const folder of shown) {
			this.renderFolderRow(table, model, folder, source, {
				showRule: false,
			});
		}

		if (!isExpanded && visible.length > limit) {
			const more = body.createEl("button", {
				cls: "ioto-template-map-more",
				text: t("MAP_EXPAND_ALL", {
					count: String(visible.length),
				}),
			});
			more.onclick = () => {
				this.expanded.add(key);
				this.renderBody();
			};
		}
	}

	private renderHeader(
		container: HTMLElement,
		model: TemplateMapModel,
	): void {
		const header = container.createDiv({ cls: "ioto-template-map-header" });
		const titleBox = header.createDiv({ cls: "ioto-template-map-title" });
		titleBox.createEl("h2", { text: t("MAP_VIEW_TITLE") });

		const badges = titleBox.createDiv({ cls: "ioto-template-map-badges" });
		badges.createSpan({
			cls: "ioto-template-map-badge",
			text: t("MAP_LOCALE_BADGE", {
				locale: model.locale,
				source: model.localeSource === "ioto-update" ? "IOTO" : "Ob",
			}),
		});
		badges.createSpan({
			cls: "ioto-template-map-badge",
			text: t("MAP_PREFIX_BADGE", { prefix: model.prefix }),
		});
		badges.createSpan({
			cls: "ioto-template-map-badge",
			text: t("MAP_GENERATED_AT", { time: this.formatTime(model.generatedAt) }),
		});

		const actions = header.createDiv({
			cls: "ioto-template-map-header-actions",
		});
		const modes = actions.createDiv({ cls: "ioto-template-map-modes" });
		modes.setAttribute("role", "tablist");
		modes.setAttribute("aria-label", t("MAP_VIEW_TITLE"));

		const makeModeBtn = (mode: MapMode, label: string, hint: string) => {
			const btn = modes.createEl("button", {
				cls: "ioto-template-map-mode-btn",
				text: label,
			});
			btn.setAttribute("role", "tab");
			btn.dataset.mode = mode;
			btn.title = hint;
			this.syncModeButtons(); // 建好一个就同步一次，新按钮不会停在 false
			btn.onclick = () => {
				if (this.mode === mode) return;
				this.mode = mode;
				this.syncModeButtons();
				this.renderBody(true); // 换了一套内容：滚动归零，且不重扫
			};
			return btn;
		};

		makeModeBtn("detail", t("MAP_MODE_DETAIL"), t("MAP_MODE_DETAIL_HINT"));
		makeModeBtn(
			"minimal",
			t("MAP_MODE_MINIMAL"),
			t("MAP_MODE_MINIMAL_HINT"),
		);

		const refresh = actions.createEl("button", {
			cls: "ioto-template-map-refresh",
		});
		setIcon(refresh, "refresh-cw");
		refresh.createSpan({ text: t("MAP_BTN_REFRESH") });
		refresh.onclick = () => {
			void this.render();
		};
	}

	private renderWarnings(
		container: HTMLElement,
		model: TemplateMapModel,
	): void {
		if (!model.warnings.includes("dict-unavailable")) return;
		const box = container.createDiv({ cls: "ioto-template-map-warnings" });
		box.createDiv({
			cls: "ioto-template-map-warning",
			text: t("MAP_ERROR_DICT"),
		});
	}

	private renderCategory(
		container: HTMLElement,
		model: TemplateMapModel,
		category: CategoryMap,
	): void {
		const card = container.createDiv({ cls: "ioto-template-map-card" });
		const head = card.createDiv({ cls: "ioto-template-map-card-head" });

		const headText = head.createDiv({ cls: "ioto-template-map-card-title" });
		headText.createSpan({
			cls: "ioto-template-map-usage",
			// 四类标题保持英文（避免顺带改版），Custom 用插件已有译名。
			text: category.usage === "Custom" ? t("Custom") : category.usage,
		});
		// 单入口是默认态，不该占视觉位；只有多入口才值得提示。
		if (category.entries.length > 1) {
			headText.createSpan({
				cls: "ioto-template-map-muted",
				text: t("MAP_ENTRY_COUNT", {
					count: String(category.entries.length),
				}),
			});
		}
		const ruleCount = category.bindingGroups.reduce(
			(sum, group) => sum + group.rules.length,
			0,
		);
		if (ruleCount > 0) {
			headText.createSpan({
				cls: "ioto-template-map-muted",
				text: t("MAP_RULES_COUNT", {
					count: String(ruleCount),
				}),
			});
		}
		// 单切换器不在分类头出现（避免与条目注脚重复），多切换器只给计数。
		const switcherCount = category.bindingGroups.filter(
			(group) => group.kind === "switcher",
		).length;
		if (switcherCount >= 2) {
			headText.createSpan({
				cls: "ioto-template-map-muted",
				text: t("MAP_SWITCHER_COUNT", {
					count: String(switcherCount),
				}),
			});
		}

		const tools = head.createDiv({
			cls: "ioto-template-map-card-tools",
		});

		if (category.usage === "Outcome") {
			const scopes = this.outcomeScopesOf(category);
			for (const info of scopes) {
				// 多根是边缘情况：给每个下拉加一个根名做区分，单根时不加任何前缀。
				if (scopes.length > 1) {
					tools.createSpan({
						cls: "ioto-template-map-muted",
						text: info.root.split("/").pop() ?? info.root,
					});
				}
				this.renderScopeSelect(tools, info);
			}
		}

		// 折叠态也要答得出「现在看的是一个项目还是全部」，所以下拉在折叠判断之前建。
		const toggle = tools.createEl("button", {
			cls: "ioto-template-map-icon-btn",
		});
		setIcon(toggle, this.collapsed.has(category.usage) ? "chevron-right" : "chevron-down");
		toggle.onclick = () => {
			if (this.collapsed.has(category.usage)) {
				this.collapsed.delete(category.usage);
			} else {
				this.collapsed.add(category.usage);
			}
			this.renderBody();
		};

		if (this.collapsed.has(category.usage)) return;

		const body = card.createDiv({ cls: "ioto-template-map-card-body" });

		if (category.error === "switcher-missing") {
			body.createDiv({
				cls: "ioto-template-map-error",
				text: t("MAP_ERROR_SWITCHER_MISSING", {
					name: category.switcher?.name ?? "",
				}),
			});
			return;
		}

		if (category.entries.length === 0) {
			body.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_NO_ENTRIES"),
			});
		}

		category.entries.forEach((entry, index) => {
			this.renderEntry(body, model, category, entry, index);
		});

		if (category.taskSlots && category.taskSlots.length > 0) {
			this.renderTaskSlots(body, category);
		}
		if (category.taskBranches && category.taskBranches.length > 0) {
			this.renderTaskBranches(body, category);
		}

		this.renderRuleTable(body, category);
	}

	/** 同一分类可能有多入口/多成果根；按 root 去重，各出一个下拉。 */
	private outcomeScopesOf(category: CategoryMap): OutcomeScopeInfo[] {
		const seen = new Map<string, OutcomeScopeInfo>();
		for (const entry of category.entries) {
			const info = entry.folderSettings.outcomeScope;
			if (!info || seen.has(info.root)) continue;
			seen.set(info.root, info);
		}
		return [...seen.values()];
	}

	private renderScopeSelect(
		tools: HTMLElement,
		info: OutcomeScopeInfo,
	): void {
		const select = tools.createEl("select", {
			cls: "dropdown ioto-template-map-scope",
		});
		select.setAttribute("aria-label", t("MAP_SCOPE_LABEL"));

		const add = (value: string, label: string) => {
			const option = select.createEl("option", { text: label });
			option.value = value;
		};

		add(
			"follow",
			info.followed
				? t("MAP_SCOPE_FOLLOW", { project: info.followed })
				: t("MAP_SCOPE_FOLLOW_DEFAULT"),
		);
		add("all", t("MAP_SCOPE_ALL", { count: String(info.projects.length) }));
		for (const project of info.projects) {
			add(`project:${project.name}`, `${project.name} (${project.rows})`);
		}

		// 值从字段回填，不从 DOM 读；重建后不会漂。options 必须先追加完。
		select.value =
			info.applied === "all"
				? "all"
				: info.applied === "project" && info.appliedProject
					? `project:${info.appliedProject}`
					: "follow";

		select.title = t(
			info.applied === "all"
				? "MAP_SCOPE_HINT_ALL"
				: info.applied === "project"
					? "MAP_SCOPE_HINT_PROJECT"
					: "MAP_SCOPE_HINT_FOLLOW",
		);

		select.onchange = () => {
			const value = select.value;
			if (value === "all") {
				this.outcomeScopes.set(info.root, { kind: "all" });
			} else if (value.startsWith("project:")) {
				this.outcomeScopes.set(info.root, {
					kind: "project",
					name: value.slice("project:".length),
				});
			} else {
				this.outcomeScopes.set(info.root, { kind: "follow" });
			}
			void this.render();
		};

		if (info.missingProject) {
			// 目录被改名/删除：清掉失效范围，只留一句灰字，绝不渲染空表。
			this.outcomeScopes.delete(info.root);
			tools.createSpan({
				cls: "ioto-template-map-scope-note",
				text: t("MAP_SCOPE_MISSING", { project: info.missingProject }),
			});
		}
	}

	/** 切换器文件本身的链接；缺失时退化成红色删除线文本。 */
	private renderSwitcherLink(
		container: HTMLElement,
		ref: FileRef | null,
		quiet = false,
	): void {
		if (!ref?.file) {
			container.createSpan({
				cls: "ioto-template-map-missing",
				text: ref?.name || "—",
			});
			return;
		}
		const link = container.createSpan({
			cls: `ioto-template-map-link${quiet ? " is-quiet" : ""}`,
			text: ref.file.path,
		});
		link.title = ref.file.path;
		link.onclick = () => this.openFile(ref.file?.path ?? "");
	}

	private renderEntry(
		container: HTMLElement,
		model: TemplateMapModel,
		category: CategoryMap,
		entry: EntryGroup,
		index: number,
	): void {
		const block = container.createDiv({ cls: "ioto-template-map-entry" });
		const key = `${category.usage}:${index}`;
		const issues = this.entryIssues(entry, category);

		let footnoteEl: HTMLElement | null = null;
		const appendFootnote = () => {
			// 摘要行从「表格之前」下移到「表格之后、注脚之前」：
			// DOM 移动即可，点击监听、aria-expanded、折叠状态都跟着走。
			const footer = block.createDiv({
				cls: "ioto-template-map-entry-footer",
			});
			footer.append(summary);
			footnoteEl = this.renderEntryFootnote(
				footer,
				model,
				category,
				entry,
				issues,
				key,
			);
		};

		// 摘要行：默认只留「来源 · 选择器 · 文件夹数」，配置细节全部下沉到注脚。
		const summary = block.createEl("button", {
			cls: "ioto-template-map-entry-summary",
		});
		summary.title = t("MAP_ENTRY_DETAILS");
		summary.setAttribute(
			"aria-expanded",
			String(this.footnoteState.get(key) ?? issues.length > 0),
		);
		const chevron = summary.createSpan({
			cls: "ioto-template-map-entry-chevron",
		});
		setIcon(
			chevron,
			(this.footnoteState.get(key) ?? issues.length > 0)
				? "chevron-down"
				: "chevron-right",
		);

		summary.createSpan({
			text: t(
				entry.source === "loader"
					? "MAP_ENTRY_SOURCE_LOADER"
					: "MAP_ENTRY_SOURCE_HOTKEY",
			),
		});
		summary.createSpan({ text: "·" });
		summary.createSpan({ text: t("MAP_FIELD_SELECTOR") });
		const selectorLink = summary.createSpan({
			cls: entry.selector.file
				? "ioto-template-map-link is-quiet"
				: "ioto-template-map-missing",
			text: entry.selector.file?.basename ?? entry.selector.name,
		});
		if (entry.selector.file) {
			selectorLink.title = entry.selector.file.path;
			selectorLink.onclick = (event: MouseEvent) => {
				// 摘要行本身是折叠开关，点链接不该连带收起/展开注脚。
				event.stopPropagation();
				this.openFile(entry.selector.file?.path ?? "");
			};
		}
		if (category.usage !== "Task") {
			summary.createSpan({ text: "·" });
			summary.createSpan({
				text: t("MAP_FOLDERS_COUNT", {
					count: String(entry.folders.length),
				}),
			});
		}
		if (issues.length > 0) {
			const flag = summary.createSpan({
				cls: "is-issue",
				text: "⚠",
			});
			flag.title = t("MAP_ISSUE_SUMMARY", {
				count: String(issues.length),
			});
		}

		summary.onclick = () => {
			const next = !(this.footnoteState.get(key) ?? issues.length > 0);
			this.footnoteState.set(key, next);
			summary.setAttribute("aria-expanded", String(next));
			setIcon(chevron, next ? "chevron-down" : "chevron-right");
			// 只改 DOM，不整体重建，滚动位置才不会被 reset。
			footnoteEl?.toggleClass("is-hidden", !next);
		};

		// 异常直出在摘要正下方，不随注脚折叠。
		for (const issue of issues) {
			block.createDiv({
				cls: `ioto-template-map-issue${issue.error ? "" : " is-warn"}`,
				text: issue.text,
			});
		}

		if (entry.folderSettings.error) {
			appendFootnote();
			return;
		}

		const visible = entry.folders.filter(
			(folder) => folder.status !== "excluded",
		);
		const excluded = entry.folders.filter(
			(folder) => folder.status === "excluded",
		);

		const isExpanded = this.expanded.has(key);
		// 全部项目模式行数天然更多，阈值放宽一档兜住；分组留待后续。
		const appliedAll =
			entry.folderSettings.outcomeScope?.applied === "all";
		const limit = appliedAll ? 50 : 20;
		const shown =
			isExpanded || visible.length <= limit
				? visible
				: visible.slice(0, limit);

		if (category.usage === "Task" || entry.folders.length === 0) {
			appendFootnote();
			return;
		}

		// 直连 / 空绑定没有规则可命中，不画规则表，只报一行口径。
		if (entry.binding.kind !== "switcher") {
			const line = block.createDiv({ cls: "ioto-template-map-muted" });
			if (entry.binding.kind === "direct-template") {
				line.createSpan({
					text: `${t("MAP_BINDING_DIRECT")}: `,
				});
				this.renderFileLink(line, entry.binding.ref);
				line.createSpan({
					cls: "ioto-template-map-via",
					text: t("MAP_DIRECT_FOLDERS", {
						count: String(visible.length),
					}),
				});
			} else if (entry.binding.kind === "unresolved") {
				line.createSpan({
					text: `${t("MAP_BINDING_UNRESOLVED")}: `,
				});
				line.createSpan({
					cls: "ioto-template-map-binding-raw",
					text: entry.binding.raw || "—",
				});
			} else {
				line.setText(t("MAP_BINDING_NONE"));
			}
			appendFootnote();
			this.renderExcludedDetails(block, model, excluded);
			return;
		}

		const table = block.createDiv({ cls: "ioto-template-map-table" });
		const headRow = table.createDiv({
			cls: "ioto-template-map-row is-head",
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell",
			text: t("MAP_COL_FOLDER"),
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell",
			text: t("MAP_COL_RULE"),
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell",
			text: t("MAP_COL_TEMPLATE"),
		});
		headRow.createDiv({
			cls: "ioto-template-map-cell is-edit",
			text: t("MAP_COL_EDIT"),
		});

		// 规则序号 -> 规则行：模板原文要用来做生成器侧的定位主键
		const source = this.editSourceOf(entry);

		for (const folder of shown) {
			this.renderFolderRow(table, model, folder, source);
		}

		if (!isExpanded && visible.length > limit) {
			const more = block.createEl("button", {
				cls: "ioto-template-map-more",
				text: t("MAP_EXPAND_ALL", { count: String(visible.length) }),
			});
			more.onclick = () => {
				this.expanded.add(key);
				this.renderBody();
			};
		}

		appendFootnote();
		this.renderExcludedDetails(block, model, excluded);
	}

	/** 摘要行上值得打断视线的异常；其余细节一律留在注脚与行内。 */
	private entryIssues(
		entry: EntryGroup,
		category: CategoryMap,
	): { text: string; error: boolean }[] {
		const issues: { text: string; error: boolean }[] = [];
		const settings = entry.folderSettings;

		if (settings.error) {
			issues.push({
				text: t("MAP_ERROR_SELECTOR", { error: settings.error }),
				error: true,
			});
		}

		const binding = entry.binding;
		if (binding.kind === "switcher") {
			if (binding.parseError === "target-missing") {
				issues.push({
					text: t("MAP_ERROR_BINDING_MISSING", {
						name: binding.ref.name,
					}),
					error: true,
				});
			}
			if (
				binding.forHint &&
				USAGE_BY_FOR[binding.forHint] !== category.usage
			) {
				issues.push({
					text: t("MAP_BINDING_FOR_MISMATCH", {
						for: binding.forHint,
					}),
					error: false,
				});
			}
		}

		const missing = entry.folders.filter(
			(folder) => folder.status === "matched-missing",
		).length;
		if (missing > 0) {
			issues.push({
				text: `${t("MAP_STATUS_MATCHED_MISSING")} ×${missing}`,
				error: true,
			});
		}

		return issues;
	}

	/** 条目配置注脚：默认隐藏（有异常时默认展开），与摘要行同一个开关。 */
	private renderEntryFootnote(
		container: HTMLElement,
		model: TemplateMapModel,
		category: CategoryMap,
		entry: EntryGroup,
		issues: { text: string; error: boolean }[],
		key: string,
	): HTMLElement {
		const footnote = container.createDiv({
			cls: "ioto-template-map-entry-footnote",
		});
		footnote.toggleClass(
			"is-hidden",
			!(this.footnoteState.get(key) ?? issues.length > 0),
		);

		const settings = entry.folderSettings;

		const line1 = footnote.createDiv({
			cls: "ioto-template-map-footnote-line",
		});
		line1.createSpan({
			text: `${t("MAP_FIELD_BASE")}: ${settings.baseFolder || "—"}`,
		});
		if (settings.outcomeScope) {
			this.renderScopeContext(line1, settings, settings.outcomeScope);
		}
		if (settings.excludeRules.length > 0) {
			const whitelist = settings.excludeRules.filter(
				(rule) => rule.include,
			).length;
			line1.createSpan({
				text: `${t("MAP_FIELD_EXCLUDES")}: ${t("MAP_EXCLUDES_DETAIL", {
					count: String(settings.excludeRules.length),
					include: String(whitelist),
				})}`,
			});
		}
		if (category.usage !== "Task") {
			line1.createSpan({
				text: `${t("MAP_FIELD_PATH_MODE")}: ${
					entry.binding.kind === "switcher" && entry.binding.pathMode
						? "on"
						: "off"
				}`,
			});
		}

		const binding = entry.binding;
		const hasVia =
			binding.kind === "switcher" ||
			binding.kind === "direct-template" ||
			entry.selector.via !== "prefix";
		if (!hasVia) return footnote;

		const line2 = footnote.createDiv({
			cls: "ioto-template-map-footnote-line",
		});
		const appendVia = (ref: FileRef) => {
			line2.createSpan({
				text: `${t("MAP_DETAILS_VIA")}: ${this.viaLabel(ref, model)}`,
			});
		};

		if (binding.kind === "switcher") {
			line2.createSpan({ text: t("MAP_DETAILS_SWITCHER") });
			if (binding.ref.file) {
				const link = line2.createSpan({
					cls: "ioto-template-map-link is-quiet",
					text: binding.ref.file.path,
				});
				link.title = binding.ref.file.path;
				link.onclick = () =>
					this.openFile(binding.ref.file?.path ?? "");
			} else {
				line2.createSpan({
					cls: "ioto-template-map-missing",
					text: binding.ref.name || "—",
				});
			}
			appendVia(binding.ref);
			return footnote;
		}

		if (binding.kind === "direct-template") {
			appendVia(binding.ref);
		}
		// 选择器的三级命中口径（My 兜底 / 原名命中）不能一并藏掉。
		if (entry.selector.via !== "prefix") appendVia(entry.selector);
		return footnote;
	}

	/** 基址的来源/范围口径：项目名在前，完整路径进 title。 */
	private renderScopeContext(
		container: HTMLElement,
		settings: FolderSettings,
		info: OutcomeScopeInfo,
	): void {
		const cls = "ioto-template-map-context";
		const path = settings.contextNote?.replace(/^active:/, "") ?? "";

		if (info.applied === "all") {
			container.createSpan({ cls, text: t("MAP_BASE_SCOPE_ALL") });
			return;
		}
		if (info.applied === "project" && info.appliedProject) {
			container.createSpan({
				cls,
				text: t("MAP_BASE_SCOPE_PROJECT", {
					project: info.appliedProject,
				}),
			});
			return;
		}
		if (info.applied === "fallback" && info.missingProject) {
			container.createSpan({
				cls: "ioto-template-map-scope-note",
				text: t("MAP_SCOPE_MISSING", { project: info.missingProject }),
			});
			return;
		}
		if (info.followedSource === "folder") {
			const span = container.createSpan({
				cls,
				text: t("MAP_BASE_CONTEXT_FOLDER", {
					project: info.followed ?? "",
				}),
			});
			span.title = path;
			return;
		}
		if (info.followedSource === "project-prop") {
			const span = container.createSpan({
				cls,
				text: t("MAP_BASE_CONTEXT_PROPERTY", {
					project: info.followed ?? "",
				}),
			});
			span.title = `${info.root}/${info.followed ?? ""}`;
			return;
		}
		container.createSpan({ cls, text: t("MAP_BASE_DEFAULT") });
	}

	private renderExcludedDetails(
		container: HTMLElement,
		model: TemplateMapModel,
		excluded: FolderRow[],
	): void {
		if (excluded.length === 0) return;
		const details = container.createEl("details", {
			cls: "ioto-template-map-details",
		});
		details.createEl("summary", {
			text: t("MAP_SECTION_EXCLUDED", {
				count: String(excluded.length),
			}),
		});
		const excludedTable = details.createDiv({
			cls: "ioto-template-map-table",
		});
		for (const folder of excluded) {
			this.renderFolderRow(excludedTable, model, folder);
		}
	}

	/** 条目级编辑源：切换器 + 规则索引表，详情版与极简版共用。 */
	private editSourceOf(entry: EntryGroup): EditSource {
		if (entry.binding.kind !== "switcher") {
			return { switcherFile: null, ruleByIndex: new Map() };
		}
		return {
			switcherFile: entry.binding.ref.file,
			ruleByIndex: new Map(
				entry.binding.rules.map((rule) => [rule.index, rule]),
			),
		};
	}

	/** 条目自己的绑定：切换器 / 直连模板 / 空 / 无法静态解析。 */
	private renderFolderRow(
		container: HTMLElement,
		model: TemplateMapModel,
		folder: FolderRow,
		source?: EditSource,
		opts?: { showRule?: boolean },
	): void {
		const row = container.createDiv({ cls: "ioto-template-map-row" });

		const folderCell = row.createDiv({ cls: "ioto-template-map-cell" });
		const name = folderCell.createSpan({
			cls: "ioto-template-map-folder",
			text: folder.name,
		});
		// 类别根的直接子目录当作视觉第一层，与表头同基线；更深层才继续缩进。
		name.style.paddingLeft = `${Math.max(0, folder.depth - 1) * 14}px`;
		name.onclick = () => this.revealFolder(folder.path);
		// 命中是默认态，只有「不一样」的状态才值得占一个徽章位。
		if (folder.status !== "matched") {
			folderCell.createSpan({
				cls: `ioto-template-map-status is-${folder.status}`,
				text: t(STATUS_KEY[folder.status]),
			});
		}
		if (folder.status === "excluded" && folder.excludedBy) {
			folderCell.createSpan({
				cls: "ioto-template-map-excluded-by",
				text: folder.excludedBy,
			});
		}

		// 极简版没有规则列：不建这一格，否则 subgrid 会多出一列空位。
		if (opts?.showRule !== false) {
			const ruleCell = row.createDiv({
				cls: "ioto-template-map-cell ioto-template-map-muted is-rule",
			});
			if (folder.ruleIndex !== null) {
				const match =
					folder.match === null || folder.match === ""
						? t("MAP_RULE_EMPTY_MATCH")
						: folder.match;
				ruleCell.setText(`#${folder.ruleIndex} · ${match}`);
			} else {
				ruleCell.setText("—");
			}
		}

		const templateCell = row.createDiv({
			cls: "ioto-template-map-cell is-template",
		});
		this.renderEffectiveTemplate(templateCell, model, folder, {
			hideVia: opts?.showRule === false,
		});

		if (!source) return;
		this.renderEditCell(row, folder, {
			switcherFile: source.switcherFile,
			rule:
				folder.ruleIndex === null
					? null
					: (source.ruleByIndex.get(folder.ruleIndex) ?? null),
		});
	}

	/** 第 4 列：铅笔 = 在生成器里打开该切换器并定位到本行。 */
	private renderEditCell(
		row: HTMLElement,
		folder: FolderRow,
		edit: EditTarget,
	): void {
		const cell = row.createDiv({ cls: "ioto-template-map-cell is-edit" });
		// excluded / direct / no-template 在四张表里实际不出现，留空保持网格对齐
		if (folder.status === "excluded") return;

		if (!edit.switcherFile) {
			const dead = cell.createSpan({
				cls: "ioto-template-map-edit-btn is-disabled",
			});
			setIcon(dead, "pencil");
			dead.title = t("MAP_EDIT_DISABLED");
			return; // 用 span 而非 disabled button：禁用按钮的 title 在部分平台不弹
		}

		const file = edit.switcherFile;
		const isDefault = folder.status === "fallback";
		const btn = cell.createEl("button", {
			cls: "ioto-template-map-edit-btn",
		});
		setIcon(btn, "pencil");
		btn.title = isDefault
			? t("MAP_EDIT_TOOLTIP_FALLBACK", { file: file.basename })
			: t("MAP_EDIT_TOOLTIP", {
					file: file.basename,
					rule: String(folder.ruleIndex ?? 0),
				});
		btn.onclick = (event: MouseEvent) => {
			event.stopPropagation();
			// 不调 this.render()：地图的 scrollTop 由 render() 存取，
			// 这里重建一次就会把「返回地图」变成回到顶部。
			void this.plugin.openSwitcherEditor(file, {
				ruleIndex: isDefault ? null : folder.ruleIndex,
				template: isDefault
					? null
					: (edit.rule?.templateRaw ?? null),
			});
		};
	}

	private renderEffectiveTemplate(
		container: HTMLElement,
		model: TemplateMapModel,
		folder: FolderRow,
		opts?: { hideVia?: boolean },
	): void {
		const direct = folder.template;
		const effective = folder.effectiveTemplate;

		if (folder.status === "excluded") {
			container.setText("—");
			return;
		}

		if (folder.status === "matched-missing" && direct) {
			container.createSpan({
				cls: "ioto-template-map-missing",
				text: direct.name,
			});
			container.createSpan({ cls: "ioto-template-map-arrow", text: "→" });
			this.renderFileLink(container, effective);
			return;
		}

		if (folder.status === "fallback") {
			this.renderFileLink(container, effective);
			return;
		}

		if (direct) {
			this.renderFileLink(container, direct);
			// 前缀命中是默认口径，只有 My 兜底 / 原名命中才提示。
			if (!opts?.hideVia && direct.via !== "prefix") {
				container.createSpan({
					cls: "ioto-template-map-via",
					text: this.viaLabel(direct, model),
				});
			}
			return;
		}

		container.setText(t("MAP_TEMPLATE_NONE"));
	}

	private renderFileLink(
		container: HTMLElement,
		ref: FileRef | null,
		quiet = false,
	): void {
		if (!ref?.file) {
			container.createSpan({
				cls: "ioto-template-map-missing",
				text: ref?.name || t("MAP_TEMPLATE_NONE"),
			});
			return;
		}
		const link = container.createSpan({
			cls: `ioto-template-map-link${quiet ? " is-quiet" : ""}`,
			text: ref.file.basename,
		});
		link.title = ref.file.path;
		link.onclick = () => this.openFile(ref.file?.path ?? "");
	}

	private renderTaskSlots(
		container: HTMLElement,
		category: CategoryMap,
	): void {
		const box = container.createDiv({ cls: "ioto-template-map-subsection" });
		box.createEl("h4", { text: t("MAP_SECTION_TASK_SLOTS") });
		const table = box.createEl("table", {
			cls: "ioto-template-map-simple-table",
		});
		for (const slot of category.taskSlots ?? []) {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: slot.label });
			const td = tr.createEl("td");
			if (slot.template.file) {
				const link = td.createSpan({
					cls: "ioto-template-map-link",
					text: slot.template.file.basename,
				});
				link.title = slot.template.file.path;
				link.onclick = () =>
					this.openFile(slot.template.file?.path ?? "");
			} else {
				td.createSpan({
					cls: "ioto-template-map-missing",
					text: slot.template.name,
				});
			}
		}
	}

	private renderTaskBranches(
		container: HTMLElement,
		category: CategoryMap,
	): void {
		const box = container.createDiv({ cls: "ioto-template-map-subsection" });
		box.createEl("h4", { text: t("MAP_SECTION_TASK_BRANCH") });
		const table = box.createEl("table", {
			cls: "ioto-template-map-simple-table",
		});
		for (const branch of category.taskBranches ?? []) {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: branch.name });
			tr.createEl("td", {
				text: t(branch.condition as TranslationKey),
			});
			tr.createEl("td", { text: branch.baseFolder || "—" });
		}
	}

	private renderRuleTable(
		container: HTMLElement,
		category: CategoryMap,
	): void {
		const groups = category.bindingGroups.filter(
			(group) => group.kind === "switcher",
		);
		if (groups.length === 0) return;

		for (const group of groups) {
			const details = container.createEl("details", {
				cls: "ioto-template-map-details",
			});
			const summary = details.createEl("summary");
			summary.createSpan({
				text: t("MAP_RULES_COUNT", {
					count: String(group.rules.length),
				}),
			});
			if (groups.length > 1) {
				summary.createSpan({ text: " · " });
				this.renderSwitcherLink(summary, group.ref);
			}

			const wrapper = details.createDiv({
				cls: "ioto-template-map-table-wrap",
			});
			const table = wrapper.createEl("table", {
				cls: "ioto-template-map-rule-table",
			});
			const head = table.createEl("thead").createEl("tr");
			for (const label of [
				"#",
				"match",
				t("MAP_RULE_COL_RAW"),
				t("MAP_RULE_COL_NAME"),
				t("MAP_RULE_COL_FILE"),
				t("MAP_RULE_COL_REACH"),
				t("MAP_RULE_COL_FLAGS"),
			]) {
				head.createEl("th", { text: label });
			}

			const body = table.createEl("tbody");
			for (const rule of group.rules) {
				const tr = body.createEl("tr");
				tr.createEl("td", { text: String(rule.index) });
				tr.createEl("td", {
					text:
						rule.match === ""
							? t("MAP_RULE_EMPTY_MATCH")
							: rule.match,
				});
				tr.createEl("td", {
					cls: "ioto-template-map-raw",
					text: rule.templateRaw || "—",
				});
				tr.createEl("td", { text: rule.templateName || "—" });
				const fileCell = tr.createEl("td");
				this.renderFileLink(fileCell, rule.template);
				tr.createEl("td", { text: String(rule.reachCount) });
				tr.createEl("td", { text: this.ruleFlags(rule) });
			}
		}
	}

	private ruleFlags(rule: RuleRow): string {
		const flags: string[] = [];
		if (rule.emptyMatch) flags.push(t("MAP_RULE_EMPTY_MATCH"));
		if (rule.duplicateOf !== null) {
			flags.push(
				t("MAP_RULE_DUPLICATE", { index: String(rule.duplicateOf) }),
			);
		}
		if (rule.shadowedBy !== null) {
			flags.push(
				t("MAP_RULE_SHADOWED", { index: String(rule.shadowedBy) }),
			);
		}
		if (rule.reachCount === 0) flags.push(t("MAP_RULE_DEAD"));
		if (rule.unresolved.length > 0) flags.push(t("MAP_RULE_UNRESOLVED"));
		return flags.join(" · ");
	}

	private renderReverseIndex(
		container: HTMLElement,
		model: TemplateMapModel,
	): void {
		const rows: ReverseIndexRow[] = model.reverseIndex;
		const card = container.createDiv({ cls: "ioto-template-map-card" });
		card.createEl("h3", { text: t("MAP_SECTION_REVERSE") });

		// 计数随范围变化：标一句口径，避免被当成固定值。
		const scopeText = this.outcomeScopeSummary(model);
		if (scopeText) {
			card.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_SCOPE_STATS", { scope: scopeText }),
			});
		}

		if (rows.length === 0) {
			card.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_EMPTY_STATE"),
			});
			return;
		}

		const table = card.createEl("table", {
			cls: "ioto-template-map-simple-table",
		});
		for (const row of rows) {
			const tr = table.createEl("tr");
			const nameCell = tr.createEl("td");
			const link = nameCell.createSpan({
				cls: "ioto-template-map-link",
				text: row.template.basename,
			});
			link.title = row.template.path;
			link.onclick = () => this.openFile(row.template.path);
			tr.createEl("td", {
				text: row.refs
					.map((ref) =>
						ref.ruleIndex === null
							? `${ref.usage}*`
							: `${ref.usage}#${ref.ruleIndex}(${ref.folderCount})`,
					)
					.join(" · "),
			});
		}
	}

	private outcomeScopeSummary(model: TemplateMapModel): string | null {
		const outcome = model.categories.find(
			(category) => category.usage === "Outcome",
		);
		if (!outcome) return null;

		const labels = new Set<string>();
		for (const entry of outcome.entries) {
			const info = entry.folderSettings.outcomeScope;
			if (!info) continue;
			labels.add(
				info.applied === "all"
					? t("MAP_BASE_SCOPE_ALL")
					: info.applied === "project" && info.appliedProject
						? t("MAP_BASE_SCOPE_PROJECT", {
								project: info.appliedProject,
							})
						: info.followed
							? t("MAP_SCOPE_FOLLOW", { project: info.followed })
							: t("MAP_SCOPE_FOLLOW_DEFAULT"),
			);
		}
		return labels.size > 0 ? [...labels].join(" · ") : null;
	}

	private renderOrphans(
		container: HTMLElement,
		model: TemplateMapModel,
	): void {
		const card = container.createDiv({ cls: "ioto-template-map-card" });
		card.createEl("h3", { text: t("MAP_SECTION_ORPHANS") });

		card.createEl("h4", { text: t("MAP_ORPHAN_MISSING") });
		if (model.orphans.missingTargets.length === 0) {
			card.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_EMPTY_STATE"),
			});
		} else {
			const table = card.createEl("table", {
				cls: "ioto-template-map-simple-table",
			});
			for (const target of model.orphans.missingTargets) {
				const tr = table.createEl("tr");
				tr.createEl("td", {
					text:
						target.ruleIndex === null
							? `${target.usage}*`
							: `${target.usage}#${target.ruleIndex}`,
				});
				tr.createEl("td", {
					cls: "ioto-template-map-missing",
					text: target.name,
				});
			}
		}

		card.createEl("h4", { text: t("MAP_ORPHAN_UNREFERENCED") });
		if (model.orphans.unreferencedTemplates.length === 0) {
			card.createDiv({
				cls: "ioto-template-map-muted",
				text: t("MAP_EMPTY_STATE"),
			});
		} else {
			const list = card.createDiv({ cls: "ioto-template-map-list" });
			for (const file of model.orphans.unreferencedTemplates) {
				const item = list.createDiv({
					cls: "ioto-template-map-link",
					text: file.path,
				});
				item.onclick = () => this.openFile(file.path);
			}
		}
	}

	/** 未挂载清单：只展示，默认收起，主链不把它当可达。 */
	private renderUnmounted(
		container: HTMLElement,
		rows: UnmountedRow[],
	): void {
		if (rows.length === 0) return;

		const card = container.createDiv({ cls: "ioto-template-map-card" });
		const details = card.createEl("details", {
			cls: "ioto-template-map-details",
		});
		details.createEl("summary", {
			text: t("MAP_SECTION_UNMOUNTED", { count: String(rows.length) }),
		});

		const table = details.createEl("table", {
			cls: "ioto-template-map-simple-table",
		});
		const head = table.createEl("tr");
		for (const label of ["MAP_COL_TYPE", "MAP_COL_NAME", "for", "MAP_COL_STATUS"]) {
			head.createEl("th", {
				text:
					label === "for"
						? "for"
						: t(label as TranslationKey),
			});
		}

		for (const row of rows) {
			const tr = table.createEl("tr");
			tr.createEl("td", { text: t(UNMOUNTED_TYPE_KEY[row.type]) });
			const nameCell = tr.createEl("td");
			if (row.file) {
				const link = nameCell.createSpan({
					cls: "ioto-template-map-link",
					text: row.name,
				});
				link.title = row.path;
				link.onclick = () => this.openFile(row.path);
			} else {
				nameCell.createSpan({
					cls: "ioto-template-map-muted",
					text: row.name,
				});
			}
			tr.createEl("td", { text: row.for ?? "—" });
			tr.createEl("td", {
				cls:
					row.reason === "hotkey-missing"
						? "ioto-template-map-missing"
						: "ioto-template-map-muted",
				text: t(UNMOUNTED_REASON_KEY[row.reason]),
			});
		}
	}

	private viaLabel(ref: FileRef, model: TemplateMapModel): string {
		switch (ref.via) {
			case "prefix":
				return t("MAP_VIA_PREFIX", { prefix: model.prefix });
			case "my":
				return t("MAP_VIA_MY");
			case "plain":
				return t("MAP_VIA_PLAIN");
			default:
				return t("MAP_VIA_DIRECT");
		}
	}

	private openFile(path: string): void {
		if (!path) return;
		void this.app.workspace.openLinkText(path, "", false);
	}

	private revealFolder(path: string): void {
		const folder = this.app.vault.getAbstractFileByPath(path);
		const explorer = (
			this.app as unknown as {
				internalPlugins?: {
					getPluginById?: (id: string) => {
						instance?: {
							revealInFolder?: (target: TAbstractFile) => void;
						};
					} | null;
				};
			}
		).internalPlugins?.getPluginById?.("file-explorer");

		if (folder && explorer?.instance?.revealInFolder) {
			explorer.instance.revealInFolder(folder);
			return;
		}

		void navigator.clipboard?.writeText(path).catch(() => undefined);
		new Notice(t("MAP_FOLDER_REVEAL_FAILED"));
	}

	private formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		const pad = (value: number) => String(value).padStart(2, "0");
		return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}
}
