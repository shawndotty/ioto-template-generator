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
} from "../services/template-map/types";

type TranslationKey = Parameters<typeof t>[0];

const STATUS_KEY: Record<FolderStatus, TranslationKey> = {
	matched: "MAP_STATUS_MATCHED",
	"matched-missing": "MAP_STATUS_MATCHED_MISSING",
	fallback: "MAP_STATUS_FALLBACK",
	excluded: "MAP_STATUS_EXCLUDED",
	"empty-match": "MAP_STATUS_EMPTY_MATCH",
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
			text: category.usage,
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
				count: String(category.rules.length),
			}),
		});
		const switcherField = headText.createSpan({
			cls: "ioto-template-map-muted",
		});
		switcherField.createSpan({
			text: `${t("MAP_FIELD_SWITCHER")}: `,
		});
		this.renderSwitcherLink(switcherField, category.switcher);

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
		this.renderSwitcherLink(sourceLine, category.switcher);
		sourceLine.createSpan({ text: t("MAP_SOURCE_LINE_SUFFIX") });
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
				})} · ${t("MAP_FIELD_PATH_MODE")}: ${category.pathMode ? "on" : "off"}`,
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

		if (excluded.length > 0) {
			const details = block.createEl("details", {
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
		if (category.rules.length === 0) return;

		const details = container.createEl("details", {
			cls: "ioto-template-map-details",
		});
		details.createEl("summary", {
			text: t("MAP_RULES_COUNT", {
				count: String(category.rules.length),
			}),
		});

		const wrapper = details.createDiv({ cls: "ioto-template-map-table-wrap" });
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
		for (const rule of category.rules) {
			const tr = body.createEl("tr");
			tr.createEl("td", { text: String(rule.index) });
			tr.createEl("td", {
				text: rule.match === "" ? t("MAP_RULE_EMPTY_MATCH") : rule.match,
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
				tr.createEl("td", { text: `${target.usage}#${target.ruleIndex}` });
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
