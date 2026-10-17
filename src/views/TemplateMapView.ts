import {
	EventRef,
	ItemView,
	Notice,
	TAbstractFile,
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
	FolderStatus,
	ReverseIndexRow,
	RuleRow,
	TemplateMapModel,
	UnmountedRow,
	USAGE_BY_FOR,
} from "../services/template-map/types";

type TranslationKey = Parameters<typeof t>[0];

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

		const container = this.contentEl;
		container.empty();
		container.addClass("ioto-template-map-container");

		try {
			const model = await this.builder.build();
			container.empty();
			this.renderModel(container, model);
		} catch (error) {
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

	private renderModel(container: HTMLElement, model: TemplateMapModel): void {
		this.renderHeader(container, model);

		if (model.warnings.includes("no-ioto-settings")) {
			container.createDiv({
				cls: "ioto-template-map-card ioto-template-map-error",
				text: t("MAP_ERROR_NO_SETTINGS"),
			});
			return;
		}

		this.renderWarnings(container, model);

		if (model.categories.length === 0) {
			container.createDiv({
				cls: "ioto-template-map-card ioto-template-map-empty",
				text: t("MAP_EMPTY_STATE"),
			});
			return;
		}

		for (const category of model.categories) {
			this.renderCategory(container, model, category);
		}

		this.renderReverseIndex(container, model.reverseIndex);
		this.renderOrphans(container, model);
		this.renderUnmounted(container, model.unmounted);
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

		const refresh = header.createEl("button", {
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
		headText.createSpan({
			cls: "ioto-template-map-muted",
			text: t("MAP_ENTRY_COUNT", {
				count: String(category.entries.length),
			}),
		});
		headText.createSpan({
			cls: "ioto-template-map-muted",
			text: t("MAP_RULES_COUNT", {
				count: String(
					category.bindingGroups.reduce(
						(sum, group) => sum + group.rules.length,
						0,
					),
				),
			}),
		});
		const switcherField = headText.createSpan({
			cls: "ioto-template-map-muted",
		});
		this.renderCategoryBinding(switcherField, category, true);

		const toggle = head.createEl("button", {
			cls: "ioto-template-map-icon-btn",
		});
		setIcon(toggle, this.collapsed.has(category.usage) ? "chevron-right" : "chevron-down");
		toggle.onclick = () => {
			if (this.collapsed.has(category.usage)) {
				this.collapsed.delete(category.usage);
			} else {
				this.collapsed.add(category.usage);
			}
			void this.render();
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

		const sourceLine = body.createDiv({
			cls: "ioto-template-map-source-line",
		});
		sourceLine.createSpan({ text: t("MAP_SOURCE_LINE_PREFIX") });
		this.renderCategoryBinding(sourceLine, category, false);
		sourceLine.createSpan({ text: t("MAP_SOURCE_LINE_SUFFIX") });
	}

	/** 分类级绑定摘要：唯一绑定给链接，多绑定给计数，无切换器给绑定形态。 */
	private renderCategoryBinding(
		container: HTMLElement,
		category: CategoryMap,
		includeLabel: boolean,
	): void {
		const groups = category.bindingGroups;
		const switchers = groups.filter((group) => group.kind === "switcher");

		if (groups.length === 0) {
			container.createSpan({ text: t("MAP_TEMPLATE_NONE") });
			return;
		}

		if (groups.length === 1) {
			const group = groups[0];
			if (!group) {
				container.createSpan({ text: t("MAP_TEMPLATE_NONE") });
				return;
			}
			if (group.kind === "switcher") {
				if (includeLabel) {
					container.createSpan({
						text: `${t("MAP_FIELD_SWITCHER")}: `,
					});
				}
				this.renderSwitcherLink(container, group.ref);
				return;
			}
			if (includeLabel) {
				container.createSpan({
					text: `${t("MAP_FIELD_BINDING")}: `,
				});
			}
			if (group.kind === "direct-template") {
				container.createSpan({
					text: `${t("MAP_BINDING_DIRECT")} · `,
				});
				this.renderFileLink(container, group.ref);
				return;
			}
			container.createSpan({
				text:
					group.kind === "unresolved"
						? t("MAP_BINDING_UNRESOLVED")
						: t("MAP_BINDING_NONE"),
			});
			return;
		}

		if (switchers.length === 0) {
			container.createSpan({ text: t("MAP_BINDING_NONE") });
			return;
		}
		if (includeLabel) {
			container.createSpan({ text: `${t("MAP_FIELD_SWITCHER")}: ` });
		}
		container.createSpan({
			text: t("MAP_SWITCHER_COUNT", {
				count: String(switchers.length),
			}),
		});
	}

	/** 切换器文件本身的链接；缺失时退化成红色删除线文本。 */
	private renderSwitcherLink(
		container: HTMLElement,
		ref: FileRef | null,
	): void {
		if (!ref?.file) {
			container.createSpan({
				cls: "ioto-template-map-missing",
				text: ref?.name || "—",
			});
			return;
		}
		const link = container.createSpan({
			cls: "ioto-template-map-link",
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
		const meta = block.createDiv({ cls: "ioto-template-map-entry-meta" });

		meta.createSpan({
			cls: `ioto-template-map-source is-${entry.source}`,
			text: t(
				entry.source === "loader"
					? "MAP_ENTRY_SOURCE_LOADER"
					: "MAP_ENTRY_SOURCE_HOTKEY",
			),
		});

		const selector = meta.createSpan({ cls: "ioto-template-map-field" });
		selector.createSpan({ text: `${t("MAP_FIELD_SELECTOR")}: ` });
		const selectorLink = selector.createSpan({
			cls: entry.selector.file
				? "ioto-template-map-link"
				: "ioto-template-map-missing",
			text: entry.selector.file?.path ?? entry.selector.name,
		});
		if (entry.selector.file) {
			selectorLink.onclick = () =>
				this.openFile(entry.selector.file?.path ?? "");
		}
		selector.createSpan({
			cls: "ioto-template-map-via",
			text: this.viaLabel(entry.selector, model),
		});

		this.renderEntryBinding(meta, category, entry);

		const base = meta.createSpan({ cls: "ioto-template-map-field" });
		base.createSpan({
			text: `${t("MAP_FIELD_BASE")}: ${entry.folderSettings.baseFolder || "—"}`,
		});
		if (entry.folderSettings.contextNote) {
			base.createSpan({
				cls: "ioto-template-map-context",
				text:
					entry.folderSettings.contextNote === "default"
						? t("MAP_BASE_DEFAULT")
						: t("MAP_BASE_CONTEXT_ACTIVE", {
								path: entry.folderSettings.contextNote.replace(
									/^active:/,
									"",
								),
							}),
			});
		}

		if (entry.folderSettings.excludeRules.length > 0) {
			const whitelist = entry.folderSettings.excludeRules.filter(
				(rule) => rule.include,
			).length;
			meta.createSpan({
				cls: "ioto-template-map-field",
				text: `${t("MAP_FIELD_EXCLUDES")}: ${t("MAP_EXCLUDES_DETAIL", {
					count: String(entry.folderSettings.excludeRules.length),
					include: String(whitelist),
				})}`,
			});
		}

		if (category.usage !== "Task") {
			meta.createSpan({
				cls: "ioto-template-map-field",
				text: `${t("MAP_FOLDERS_COUNT", {
					count: String(entry.folders.length),
				})} · ${t("MAP_FIELD_PATH_MODE")}: ${
					entry.binding.kind === "switcher" && entry.binding.pathMode
						? "on"
						: "off"
				}`,
			});
		}

		if (entry.folderSettings.error) {
			block.createDiv({
				cls: "ioto-template-map-error",
				text: t("MAP_ERROR_SELECTOR", {
					error: entry.folderSettings.error,
				}),
			});
			return;
		}

		const visible = entry.folders.filter(
			(folder) => folder.status !== "excluded",
		);
		const excluded = entry.folders.filter(
			(folder) => folder.status === "excluded",
		);

		const key = `${category.usage}:${index}`;
		const isExpanded = this.expanded.has(key);
		const limit = 20;
		const shown =
			isExpanded || visible.length <= limit
				? visible
				: visible.slice(0, limit);

		if (category.usage === "Task" || entry.folders.length === 0) {
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
			} else {
				line.setText(t("MAP_BINDING_NONE"));
			}
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

		for (const folder of shown) {
			this.renderFolderRow(table, model, folder);
		}

		if (!isExpanded && visible.length > limit) {
			const more = block.createEl("button", {
				cls: "ioto-template-map-more",
				text: t("MAP_EXPAND_ALL", { count: String(visible.length) }),
			});
			more.onclick = () => {
				this.expanded.add(key);
				void this.render();
			};
		}

		this.renderExcludedDetails(block, model, excluded);
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

	/** 条目自己的绑定：切换器 / 直连模板 / 空 / 无法静态解析。 */
	private renderEntryBinding(
		container: HTMLElement,
		category: CategoryMap,
		entry: EntryGroup,
	): void {
		const field = container.createSpan({ cls: "ioto-template-map-field" });
		const binding = entry.binding;

		if (binding.kind === "switcher") {
			field.createSpan({ text: `${t("MAP_FIELD_SWITCHER")}: ` });
			this.renderSwitcherLink(field, binding.ref);
			if (binding.parseError === "target-missing") {
				field.createSpan({
					cls: "ioto-template-map-error",
					text: t("MAP_ERROR_BINDING_MISSING", {
						name: binding.ref.name,
					}),
				});
			}
			if (
				binding.forHint &&
				USAGE_BY_FOR[binding.forHint] !== category.usage
			) {
				field.createSpan({
					cls: "ioto-template-map-context",
					text: t("MAP_BINDING_FOR_MISMATCH", {
						for: binding.forHint,
					}),
				});
			}
			return;
		}

		if (binding.kind === "direct-template") {
			field.createSpan({ text: `${t("MAP_BINDING_DIRECT")}: ` });
			this.renderFileLink(field, binding.ref);
			return;
		}

		if (binding.kind === "none") {
			field.createSpan({ text: t("MAP_BINDING_NONE") });
			return;
		}

		field.createSpan({ text: `${t("MAP_BINDING_UNRESOLVED")}: ` });
		field.createSpan({
			cls: "ioto-template-map-binding-raw",
			text: binding.raw || "—",
		});
	}

	private renderFolderRow(
		container: HTMLElement,
		model: TemplateMapModel,
		folder: FolderRow,
	): void {
		const row = container.createDiv({ cls: "ioto-template-map-row" });

		const folderCell = row.createDiv({ cls: "ioto-template-map-cell" });
		const name = folderCell.createSpan({
			cls: "ioto-template-map-folder",
			text: folder.name,
		});
		name.style.paddingLeft = `${folder.depth * 14}px`;
		name.onclick = () => this.revealFolder(folder.path);
		folderCell.createSpan({
			cls: `ioto-template-map-status is-${folder.status}`,
			text: t(STATUS_KEY[folder.status]),
		});
		if (folder.status === "excluded" && folder.excludedBy) {
			folderCell.createSpan({
				cls: "ioto-template-map-excluded-by",
				text: folder.excludedBy,
			});
		}

		const ruleCell = row.createDiv({
			cls: "ioto-template-map-cell ioto-template-map-muted",
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

		const templateCell = row.createDiv({ cls: "ioto-template-map-cell" });
		this.renderEffectiveTemplate(templateCell, model, folder);
	}

	private renderEffectiveTemplate(
		container: HTMLElement,
		model: TemplateMapModel,
		folder: FolderRow,
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
			container.createSpan({
				cls: "ioto-template-map-via",
				text: this.viaLabel(direct, model),
			});
			return;
		}

		container.setText(t("MAP_TEMPLATE_NONE"));
	}

	private renderFileLink(
		container: HTMLElement,
		ref: FileRef | null,
	): void {
		if (!ref?.file) {
			container.createSpan({
				cls: "ioto-template-map-missing",
				text: ref?.name || t("MAP_TEMPLATE_NONE"),
			});
			return;
		}
		const link = container.createSpan({
			cls: "ioto-template-map-link",
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
		rows: ReverseIndexRow[],
	): void {
		const card = container.createDiv({ cls: "ioto-template-map-card" });
		card.createEl("h3", { text: t("MAP_SECTION_REVERSE") });
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
