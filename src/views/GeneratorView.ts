import {
	App,
	ItemView,
	WorkspaceLeaf,
	Setting,
	Notice,
	ButtonComponent,
	setIcon,
	TFile,
	TextComponent,
} from "obsidian";
import {
	Usage,
	TemplateOption,
	ConfigPreset,
	TemplateType,
} from "../types/types";
import { TEMPLATE_OPTIONS, GENERATOR_VIEW_TYPE } from "../models/constants";
import { SWITCHERS_TEMPLATE_OPTIONS } from "../models/constantsSwitcher";
import { ImagePreviewModal } from "../modals/ImagePreviewModal";
import { ImportModal } from "../modals/ImportModal";
import { ScriptPreviewModal } from "../modals/ScriptPreviewModal";
import { ObjectEditModal } from "../modals/ObjectEditModal";
import { ArrayEditModal } from "../modals/ArrayEditModal";
import { ScriptEngine } from "../processors/ScriptEngine";
import { FolderPickerModal } from "../ui/pickers/folder-picker";
import { FilePickerModal } from "../ui/pickers/file-picker";
import { PresetLoadModal } from "../modals/PresetLoadModal";
import { PresetSaveModal } from "../modals/PresetSaveModal";
import IOTOTemplateGeneratorPlugin from "../main";
import { t } from "../lang/helpers";

export class GeneratorView extends ItemView {
	app: App;
	type: TemplateType = "Selector";
	usage: Usage = "Input";
	folderSettings: Record<string, string> = {};
	noteSettings: Record<string, any> = {};
	activeOption: TemplateOption | null = null;
	importedFile: TFile | null = null;
	activeTab: "Folder" | "Note" | "Folder" = "Folder";
	plugin: IOTOTemplateGeneratorPlugin;
	platformListCollapsed = false;
	rightPanelCollapsed = false;

	// UI Elements
	middleContainer: HTMLElement;
	rightContainer: HTMLElement;
	userTemplatePrefix: string;

	constructor(leaf: WorkspaceLeaf, plugin: IOTOTemplateGeneratorPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.app = this.plugin.app;
		this.userTemplatePrefix =
			this.app.plugins.plugins["ioto-settings"]?.settings
				.userTemplatePrefix || "";
	}

	getViewType() {
		return GENERATOR_VIEW_TYPE;
	}

	getDisplayText() {
		return t("GENERATOR_VIEW_TITLE");
	}

	getIcon() {
		return "package";
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass("sync-generator-container");

		const grid = container.createDiv({ cls: "sync-generator-grid" });
		if (this.platformListCollapsed) {
			grid.addClass("usages-collapsed");
		}
		if (this.rightPanelCollapsed) {
			grid.addClass("right-collapsed");
		}

		// Left Column: Usage List
		const leftCol = grid.createDiv({ cls: "sync-generator-left" });
		this.renderUsageList(leftCol);

		// Middle Column: Settings Form
		this.middleContainer = grid.createDiv({ cls: "sync-generator-middle" });

		// Right Column: Help/Description
		this.rightContainer = grid.createDiv({ cls: "sync-generator-right" });

		this.renderMiddleColumn();
		this.renderRightColumn();
	}

	renderUsageList(container: HTMLElement) {
		container.empty();
		const header = container.createDiv({ cls: "usage-header" });
		if (!this.platformListCollapsed) {
			header.createEl("h3", {
				text: t("GENERATOR_VIEW_USAGE_TITLE"),
			});
		}
		const toggle = header.createEl("button", {
			cls: "usage-toggle",
		});
		setIcon(
			toggle,
			this.platformListCollapsed ? "chevrons-right" : "chevrons-left",
		);
		toggle.onclick = () => {
			const grid = container.closest(".sync-generator-grid");
			this.platformListCollapsed = !this.platformListCollapsed;
			if (grid) {
				if (this.platformListCollapsed) {
					grid.addClass("usages-collapsed");
				} else {
					grid.removeClass("usages-collapsed");
				}
			}
			this.renderUsageList(container);
		};

		const types: TemplateType[] = ["Selector", "Switcher"];
		const usages: Usage[] = [
			"Input",
			"Output",
			"Task",
			"Outcome",
			"Custom",
		];
		types.forEach((type) => {
			const typeItem = container.createEl("h4", {
				text: this.platformListCollapsed
					? t(`${type}`).slice(0, 2)
					: t(`${type}`),
				cls: this.platformListCollapsed
					? "usage-type-short"
					: "usage-type",
			});

			const list = container.createEl("ul", {
				cls: this.platformListCollapsed
					? "usage-list usage-list-collapsed"
					: "usage-list",
			});
			usages.forEach((u) => {
				const label = this.platformListCollapsed ? u.charAt(0) : u;
				const item = list.createEl("li", {
					text: label,
					cls: "usage-item",
					attr: { "data-type": type, "data-usage": u },
				});
				if (u === this.usage && type === this.type)
					item.addClass("is-active");

				item.onclick = () => {
					this.type = type;
					this.usage = u;
					// Reset imported file context when switching usages manually
					this.importedFile = null;
					this.folderSettings = {};
					this.noteSettings = {};

					container
						.findAll(".usage-item")
						.forEach((el) => el.removeClass("is-active"));
					item.addClass("is-active");
					this.renderMiddleColumn();
					this.activeOption = null;
					this.renderRightColumn();
				};
			});
		});
	}

	renderMiddleColumn() {
		this.middleContainer.empty();
		this.middleContainer.createEl("h2", {
			text: `${t(this.type)} - ${this.usage} ${t("GENERATOR_VIEW_SETTINGS_SUFFIX")}`,
		});

		// Action Bar
		const actionBar = this.middleContainer.createDiv({ cls: "action-bar" });
		if (this.importedFile) {
			actionBar.createEl("p", {
				text: `${t("GENERATOR_VIEW_CURRENT_FILE")}: ${this.importedFile.name}`,
				attr: { style: "width: 100%; margin: 0 0 10px 0" },
			});
		}
		new ButtonComponent(actionBar)
			.setButtonText(t("GENERATOR_VIEW_BTN_IMPORT_TEMPLATE"))
			.setIcon("import")
			.setTooltip(t("GENERATOR_VIEW_BTN_IMPORT_TEMPLATE"))
			.onClick(() => this.openImportModal());

		// Load Default Template button (only show if default template is set)
		const defaultTemplatePath = this.getDefaultTemplatePath(this.type);
		if (defaultTemplatePath) {
			new ButtonComponent(actionBar)
				.setButtonText(t("GENERATOR_VIEW_BTN_LOAD_DEFAULT"))
				.setIcon("file-down")
				.setTooltip(t("GENERATOR_VIEW_BTN_LOAD_DEFAULT"))
				.onClick(() => this.loadDefaultTemplate());
		}

		new ButtonComponent(actionBar)
			.setButtonText(t("GENERATOR_VIEW_BTN_PRESETS"))
			.setIcon("bookmark")
			.setTooltip(t("GENERATOR_VIEW_BTN_PRESETS"))
			.onClick(() => this.openPresetLoadModal());

		new ButtonComponent(actionBar)
			.setButtonText(t("GENERATOR_VIEW_BTN_SAVE_PRESET"))
			.setIcon("save")
			.setTooltip(t("GENERATOR_VIEW_BTN_SAVE_PRESET"))
			.onClick(() => this.openPresetSaveModal());

		new ButtonComponent(actionBar)
			.setButtonText(t("GENERATOR_VIEW_BTN_GENERATE"))
			.setCta()
			.onClick(() => this.generateScript());

		// Tabs
		const tabsContainer = this.middleContainer.createDiv({
			cls: "settings-tabs",
		});
		const formContainer = this.middleContainer.createDiv({
			cls: "settings-form",
		});
		if ("Selector" === this.type) {
			const tabs: ("Folder" | "Note")[] = ["Folder", "Note"];

			const tabNames: Record<string, string> = {
				Folder: t("GENERATOR_VIEW_TAB_FOLDER"),
				Note: t("GENERATOR_VIEW_TAB_NOTE"),
			};

			tabs.forEach((tab) => {
				const tabBtn = tabsContainer.createEl("button", {
					text: `${tabNames[tab]} ${t("GENERATOR_VIEW_SETTINGS_SUFFIX")}`,
					cls: "settings-tab-btn",
				});
				if (this.activeTab === tab) tabBtn.addClass("is-active");

				tabBtn.onclick = () => {
					this.activeTab = tab;
					this.renderMiddleColumn();
				};
			});

			if (this.activeTab === "Folder") {
				const folderOptions = TEMPLATE_OPTIONS.filter(
					(o) =>
						o.level === "Folder" &&
						o.for === this.usage &&
						o.type === this.type,
				).sort((a, b) => a.order - b.order);
				folderOptions.forEach((opt) => {
					this.renderOption(
						formContainer,
						opt,
						this.folderSettings,
						"Folder",
					);
				});
			}

			if (this.activeTab === "Note") {
				const noteOptions = TEMPLATE_OPTIONS.filter(
					(o) =>
						o.level === "Note" &&
						o.for === this.usage &&
						o.type === this.type,
				).sort((a, b) => a.order - b.order);

				noteOptions.forEach((opt) => {
					this.renderOption(
						formContainer,
						opt,
						this.noteSettings,
						"Note",
					);
				});
			}
		}
		if ("Switcher" === this.type) {
			const switcherOptions = SWITCHERS_TEMPLATE_OPTIONS.filter(
				(o) =>
					o.level === "Folder" &&
					o.for === this.usage &&
					o.type === this.type,
			).sort((a, b) => a.order - b.order);
			switcherOptions.forEach((opt) => {
				this.renderSwitcherOption(
					formContainer,
					opt,
					this.folderSettings,
					"Folder",
				);
			});
		}
	}

	renderOption(
		container: HTMLElement,
		opt: TemplateOption,
		target: any,
		section: string,
	) {
		const s = new Setting(container).setName(opt.title || opt.name);
		s.nameEl.addEventListener("click", () => {
			this.activeOption = opt;
			this.renderRightColumn();
		});
		s.nameEl.style.cursor = "pointer";

		const handleFocus = (el: HTMLElement) => {
			this.addFocusListener(el, opt);
		};

		if (opt.valueType === "boolean") {
			s.addToggle((toggle) => {
				toggle
					.setValue(target[opt.name] ?? opt.defaultValue === true)
					.onChange((val) => (target[opt.name] = val));
				handleFocus(toggle.toggleEl);
			});
		} else if (opt.valueType === "array") {
			s.addExtraButton((btn) => {
				btn.setIcon("pencil")
					.setTooltip(t("GENERATOR_VIEW_TOOLTIP_EDIT_ARRAY"))
					.onClick(() => {
						let currentData = target[opt.name];
						if (typeof currentData === "string") {
							try {
								currentData = JSON.parse(currentData);
							} catch {
								currentData = [];
							}
						}
						if (!Array.isArray(currentData)) {
							currentData = [];
						}

						new ArrayEditModal(
							this.app,
							opt.title || opt.name,
							currentData,
							(result) => {
								target[opt.name] = result;
								this.renderMiddleColumn();
							},
						).open();
					});
			});

			s.addTextArea((text) => {
				text.setPlaceholder(opt.example || "")
					.setValue(
						target[opt.name]
							? JSON.stringify(target[opt.name], null, 2)
							: "",
					)
					.onChange((val) => {
						try {
							target[opt.name] = JSON.parse(val);
						} catch (e) {
							// Silent failure
						}
					});
				handleFocus(text.inputEl);
			});
		} else if (opt.valueType === "integer") {
			if (opt.asSelector) {
				s.addDropdown((dropdown) => {
					opt.choices?.forEach((choice) => {
						dropdown.addOption(choice.value, choice.label);
					});
					dropdown.setValue(target[opt.name] || opt.defaultValue);
					dropdown.onChange((val) => (target[opt.name] = val));
					handleFocus(dropdown.selectEl);
				});
			} else {
				s.addText((text) => {
					text.setValue(
						target[opt.name].toString() ||
							(opt.defaultValue === ""
								? ""
								: opt.defaultValue.toString()) ||
							"",
					).onChange((val) => {
						// 只允许输入数字
						if (/^\d*$/.test(val)) {
							target[opt.name] = val;
						}
					});
					// 设置输入类型为数字
					text.inputEl.type = "number";
					handleFocus(text.inputEl);
				});
			}
		} else if (opt.valueType === "path") {
			s.addText((text) => {
				text.setPlaceholder(opt.example || "")
					.setValue(
						target[opt.name] ||
							(opt.defaultValue === "" ? "" : opt.defaultValue) ||
							"",
					)
					.onChange((val) => (target[opt.name] = val));
				handleFocus(text.inputEl);
			}).addButton((btn) => {
				btn.setIcon("folder")
					.setTooltip("Choose a folder")
					.onClick(() => {
						new FolderPickerModal(this.app, (selectedFolder) => {
							target[opt.name] = selectedFolder.path;
							this.renderMiddleColumn();
						}).open();
					});
			});
		} else if (opt.valueType === "file") {
			if (opt.name === "template") {
				s.addButton((btn) => {
					btn.setButtonText("Prefix").onClick(() => {
						let prefix = this.userTemplatePrefix
							? `${this.userTemplatePrefix}-`
							: "";
						target[opt.name] =
							`${prefix}TP-${t(this.usage)}-${t("Switcher")}-`;
						this.renderMiddleColumn();
					});
				});
			}
			s.addText((text) => {
				text.setPlaceholder(opt.example || "")
					.setValue(
						target[opt.name] ||
							(opt.defaultValue === "" ? "" : opt.defaultValue) ||
							"",
					)
					.onChange((val) => (target[opt.name] = val));
				handleFocus(text.inputEl);
			}).addButton((btn) => {
				btn.setIcon("file")
					.setTooltip("Choose a file")
					.onClick(() => {
						new FilePickerModal(
							this.app,
							(selectedFile) => {
								target[opt.name] = selectedFile.basename;
								this.renderMiddleColumn();
							},
							["MyIOTO", "Templates", "Templater", t(this.usage)],
						).open();
					});
			});
		} else {
			s.addText((text) => {
				text.setValue(
					target[opt.name] ||
						(opt.defaultValue === "" ? "" : opt.defaultValue) ||
						"",
				).onChange((val) => (target[opt.name] = val));
				handleFocus(text.inputEl);
			});
		}
	}

	renderSwitcherOption(
		container: HTMLElement,
		opt: TemplateOption,
		target: any,
		section: string,
	) {
		const s = new Setting(container).setName(opt.title || opt.name);
		s.nameEl.addEventListener("click", () => {
			this.activeOption = opt;
			this.renderRightColumn();
		});
		s.nameEl.style.cursor = "pointer";

		const handleFocus = (el: HTMLElement) => {
			this.addFocusListener(el, opt);
		};

		if (opt.valueType === "boolean") {
			s.addToggle((toggle) => {
				toggle
					.setValue(target[opt.name] ?? opt.defaultValue === true)
					.onChange((val) => (target[opt.name] = val));
				handleFocus(toggle.toggleEl);
			});
		} else if (opt.valueType === "array") {
			const listContainer = container.createDiv({
				cls: "switcher-array-list-container",
			});
			// Ensure it's an array
			if (!Array.isArray(target[opt.name])) {
				if (Array.isArray(opt.defaultValue)) {
					target[opt.name] = JSON.parse(
						JSON.stringify(opt.defaultValue),
					);
				} else {
					target[opt.name] = [];
				}
			}

			const renderList = () => {
				listContainer.empty();
				const items = target[opt.name];

				items.forEach((item: any, index: number) => {
					const row = listContainer.createDiv({
						cls: "switcher-array-row",
					});
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.gap = "10px";
					row.style.marginBottom = "8px";
					row.style.marginRight = "16px";
					row.style.paddingLeft = "20px";

					// Match Input
					const matchInput = new TextComponent(row);
					matchInput.setPlaceholder(t("FULL_OR_PARTIAL_FOLDER_NAME"));
					matchInput.setValue(item.match || "");
					matchInput.onChange((val) => {
						item.match = val;
					});
					matchInput.inputEl.style.width = "150px";
					matchInput.inputEl.style.marginRight = "10px";

					const prefixBtn = new ButtonComponent(row);
					prefixBtn.setButtonText("Prefix");
					prefixBtn.onClick(() => {
						let prefix = this.userTemplatePrefix
							? `${this.userTemplatePrefix}-`
							: "";
						item.template = `${prefix}TP-${t(this.usage)}-${item.match}`;
						this.renderMiddleColumn();
					});

					// Template Input
					const templateInput = new TextComponent(row);
					templateInput.setPlaceholder(t("TEMPLATE_FILE_NAME"));
					templateInput.setValue(item.template || "");
					templateInput.onChange((val) => {
						item.template = val;
					});
					templateInput.inputEl.style.flex = "1";

					const fileBtn = new ButtonComponent(row);
					fileBtn.setIcon("file");
					fileBtn.setTooltip("Choose a file");
					fileBtn.onClick(() => {
						new FilePickerModal(
							this.app,
							(selectedFile) => {
								item.template = selectedFile.basename;
								this.renderMiddleColumn();
							},
							["MyIOTO", "Templates", "Templater", t(this.usage)],
						).open();
					});

					// Delete Button
					const delBtn = new ButtonComponent(row);
					delBtn.setIcon("trash");
					delBtn.setTooltip("Delete");
					delBtn.onClick(() => {
						items.splice(index, 1);
						renderList();
					});
				});
			};

			s.addButton((btn) => {
				btn.setButtonText("Add Item")
					.setIcon("plus")
					.onClick(() => {
						target[opt.name].push({ match: "", template: "" });
						renderList();
					});
			});

			renderList();
		} else if (opt.valueType === "object") {
			s.addExtraButton((btn) => {
				btn.setIcon("pencil")
					.setTooltip(t("GENERATOR_VIEW_TOOLTIP_EDIT_OBJECT"))
					.onClick(() => {
						let currentData = target[opt.name];
						if (typeof currentData === "string") {
							try {
								currentData = JSON.parse(currentData);
							} catch {
								currentData = {};
							}
						}
						if (
							!currentData ||
							typeof currentData !== "object" ||
							Array.isArray(currentData)
						) {
							currentData = {};
						}

						new ObjectEditModal(
							this.app,
							opt.title || opt.name,
							currentData,
							(result) => {
								target[opt.name] = result;
								this.renderMiddleColumn();
							},
						).open();
					});
			});

			s.addTextArea((text) => {
				text.setPlaceholder(opt.example || "")
					.setValue(
						target[opt.name]
							? JSON.stringify(target[opt.name], null, 2)
							: "",
					)
					.onChange((val) => {
						try {
							target[opt.name] = JSON.parse(val);
						} catch (e) {
							// Silent failure for partial JSON input
						}
					});
				handleFocus(text.inputEl);
			});
		} else if (opt.valueType === "file") {
			s.addText((text) => {
				text.setPlaceholder(opt.example || "")
					.setValue(
						target[opt.name] ||
							(opt.defaultValue === "" ? "" : opt.defaultValue) ||
							"",
					)
					.onChange((val) => (target[opt.name] = val));
				handleFocus(text.inputEl);
			}).addButton((btn) => {
				btn.setIcon("file")
					.setTooltip("Choose a file")
					.onClick(() => {
						new FilePickerModal(
							this.app,
							(selectedFile) => {
								target[opt.name] = selectedFile.basename;
								this.renderMiddleColumn();
							},
							["MyIOTO", "Templates", "Templater", t(this.usage)],
						).open();
					});
			});
		} else {
			s.addText((text) => {
				text.setValue(
					target[opt.name] ||
						(opt.defaultValue === "" ? "" : opt.defaultValue) ||
						"",
				).onChange((val) => (target[opt.name] = val));
				handleFocus(text.inputEl);
			});
		}
	}

	addFocusListener(el: HTMLElement, opt: TemplateOption) {
		el.addEventListener("focus", () => {
			this.activeOption = opt;
			this.renderRightColumn();
		});
		el.addEventListener("click", () => {
			this.activeOption = opt;
			this.renderRightColumn();
		});
	}

	renderRightColumn() {
		const grid = this.rightContainer.closest(".sync-generator-grid");
		if (grid) {
			if (this.rightPanelCollapsed) {
				grid.addClass("right-collapsed");
			} else {
				grid.removeClass("right-collapsed");
			}
		}

		this.rightContainer.empty();

		if (this.rightPanelCollapsed) {
			this.rightContainer.addClass("is-collapsed");
			const toggleOnly = this.rightContainer.createEl("button", {
				cls: "help-toggle-only",
			});
			setIcon(toggleOnly, "chevrons-left");
			toggleOnly.onclick = () => {
				this.rightPanelCollapsed = false;
				this.renderRightColumn();
			};
			return;
		}

		this.rightContainer.removeClass("is-collapsed");

		const header = this.rightContainer.createDiv({ cls: "help-header" });
		header.createEl("h3", {
			text: t("GENERATOR_VIEW_DESC_TITLE"),
		});
		const toggle = header.createEl("button", {
			cls: "help-toggle",
		});
		setIcon(toggle, "chevrons-right");
		toggle.onclick = () => {
			this.rightPanelCollapsed = true;
			this.renderRightColumn();
		};

		if (this.activeOption) {
			const wrapper = this.rightContainer.createDiv({
				cls: "help-content",
			});
			wrapper.createEl("h4", {
				text: this.activeOption.name,
				cls: "help-title",
			});

			const badge = wrapper.createSpan({ cls: "help-badge" });
			const levelMap: Record<string, string> = {
				Folder: t("GENERATOR_VIEW_TAB_FOLDER"),
				Note: t("GENERATOR_VIEW_TAB_NOTE"),
			};
			badge.setText(
				levelMap[this.activeOption.level] || this.activeOption.level,
			);

			wrapper.createEl("div", {
				text: this.activeOption.description,
				cls: "help-desc",
			});

			if (this.activeOption.defaultValue !== undefined) {
				wrapper.createEl("h5", {
					text: t("GENERATOR_VIEW_DEFAULT_LABEL"),
				});
				// Default Value & Reset
				const defaultContainer = wrapper.createDiv({
					cls: "help-default-container",
				});

				const defaultValStr =
					typeof this.activeOption.defaultValue === "object"
						? JSON.stringify(this.activeOption.defaultValue)
						: String(this.activeOption.defaultValue);

				defaultContainer.createEl("code", {
					text: defaultValStr,
					cls: "help-default-value",
				});

				const resetBtn = defaultContainer.createEl("button", {
					cls: "help-reset-btn",
					attr: {
						"aria-label": t("GENERATOR_VIEW_RESET_TOOLTIP"),
					},
				});
				setIcon(resetBtn, "rotate-ccw");
				resetBtn.onclick = () => {
					if (!this.activeOption) return;

					const targetSettings =
						this.activeOption.level === "Note"
							? this.noteSettings
							: this.folderSettings;

					let newValue = this.activeOption.defaultValue;
					if (typeof newValue === "object" && newValue !== null) {
						newValue = JSON.parse(JSON.stringify(newValue));
					}

					targetSettings[this.activeOption.name] = newValue;
					this.renderMiddleColumn();
					new Notice(t("GENERATOR_VIEW_RESET_TOOLTIP"));
				};
			}

			if (this.activeOption.example) {
				wrapper.createEl("h5", {
					text: t("GENERATOR_VIEW_EXAMPLE_USAGE_TITLE"),
				});
				wrapper.createEl("pre", {
					text: this.activeOption.example,
					cls: "help-example",
				});
			}

			if (this.activeOption.imageExplain) {
				wrapper.createEl("h5", {
					text: t("GENERATOR_VIEW_IMAGE_EXPLAIN_TITLE"),
				});
				const imageUrl = this.activeOption.imageExplain;
				const img = wrapper.createEl("img", {
					attr: {
						src: imageUrl,
					},
					cls: "help-image-explain",
				});
				img.onclick = () => {
					new ImagePreviewModal(this.app, imageUrl).open();
				};
			}
		} else {
			this.rightContainer.createEl("p", {
				text: t("GENERATOR_VIEW_DESC_PLACEHOLDER"),
				cls: "help-placeholder",
			});
		}
	}

	openImportModal() {
		new ImportModal(this.app, (file) => this.importTemplate(file), [
			t(this.usage),
			t(this.type),
		]).open();
	}

	async importTemplate(file: TFile) {
		const content = await this.app.vault.read(file);
		this.importedFile = file;

		// 提取公共逻辑
		const applyResult = (result: {
			usage?: Usage;
			type?: TemplateType;
			folderSettings?: Record<string, any>;
			noteSettings?: Record<string, any>;
		}) => {
			if (result.usage && result.type) {
				this.type = result.type;
				this.usage = result.usage;
				this.folderSettings = result.folderSettings || {};
				this.noteSettings = result.noteSettings || {};
				new Notice(
					t("GENERATOR_VIEW_NOTICE_IMPORTED").replace(
						"${file}",
						file.basename,
					),
				);
				// 更新 UI 列表激活状态
				// 页面中有两个 .usage-list，根据 this.type 选择对应的列表
				// 批量更新激活状态
				this.containerEl
					.querySelectorAll<HTMLElement>(".usage-list .usage-item")
					.forEach((el) => {
						const isMatch =
							el.dataset.usage === this.usage &&
							el.dataset.type === this.type;
						el.toggleClass("is-active", isMatch);
					});
				this.renderMiddleColumn();
			} else {
				new Notice(t("GENERATOR_VIEW_NOTICE_NO_PLATFORM"));
			}
		};

		switch (this.type) {
			case "Selector":
				const result = ScriptEngine.parseSelector(content);
				applyResult({
					usage: result.usage ?? undefined,
					type: result.type ?? undefined,
					folderSettings: result.folderSettings,
					noteSettings: result.noteSettings,
				});
				break;
			case "Switcher":
				const switcherResult = ScriptEngine.parseSwitcher(content);
				applyResult({
					usage: switcherResult.usage ?? undefined,
					type: switcherResult.type ?? undefined,
					folderSettings: switcherResult.folderSettings,
				});
				break;
			default:
				break;
		}
	}

	generateScript() {
		let template = "";
		switch (this.type) {
			case "Selector":
				template = ScriptEngine.generateSelector(
					this.usage,
					this.folderSettings,
					this.noteSettings,
				);
				break;
			case "Switcher":
				template = ScriptEngine.generateSwitcher(
					this.usage,
					this.folderSettings,
				);
				break;
			default:
				break;
		}
		new ScriptPreviewModal(
			this.app,
			this.plugin.settings,
			template,
			this.usage,
			this.type,
			this.importedFile,
			this.folderSettings,
			this.noteSettings,
		).open();
	}

	openPresetSaveModal() {
		const currentSettings = {
			usage: this.usage,
			for: this.type,
			folderSettings: this.folderSettings,
			noteSettings: this.noteSettings,
		};

		new PresetSaveModal(
			this.app,
			this.plugin.settings.presets || [],
			currentSettings,
			(preset) => this.savePreset(preset),
		).open();
	}

	openPresetLoadModal() {
		new PresetLoadModal(
			this.app,
			this.plugin.settings.presets || [],
			(preset) => this.loadPreset(preset),
			(presetId) => this.deletePreset(presetId),
		).open();
	}

	async savePreset(preset: ConfigPreset) {
		if (!this.plugin.settings.presets) {
			this.plugin.settings.presets = [];
		}
		this.plugin.settings.presets.push(preset);
		await this.plugin.saveSettings();
	}

	async loadPreset(preset: ConfigPreset) {
		this.usage = preset.usage;
		this.type = preset.for;
		this.folderSettings = { ...preset.folderSettings };
		this.noteSettings = { ...preset.noteSettings };
		this.folderSettings = JSON.parse(JSON.stringify(preset.folderSettings)); // Deep copy
		this.importedFile = null; // Clear imported file context

		// Update UI
		this.containerEl
			.querySelectorAll<HTMLElement>(".usage-list .usage-item")
			.forEach((el) => {
				const isMatch =
					el.dataset.usage === this.usage &&
					el.dataset.type === this.type;
				el.toggleClass("is-active", isMatch);
			});

		this.renderMiddleColumn();
		this.activeOption = null;
		this.renderRightColumn();
	}

	async deletePreset(presetId: string) {
		if (!this.plugin.settings.presets) return;
		this.plugin.settings.presets = this.plugin.settings.presets.filter(
			(p) => p.id !== presetId,
		);
		await this.plugin.saveSettings();
	}

	private getDefaultTemplatePath(type: TemplateType): string {
		const selectorUseageSettingsMap: Record<
			Usage,
			keyof typeof this.plugin.settings
		> = {
			Input: "defaultInputSelectorPath",
			Output: "defaultOutputSelectorPath",
			Task: "defaultTaskSelectorPath",
			Outcome: "defaultOutcomeSelectorPath",
			Custom: "defaultCustomSelectorPath",
		};

		const switcherUseageSettingsMap: Record<
			Usage,
			keyof typeof this.plugin.settings
		> = {
			Input: "defaultInputSwitcherPath",
			Output: "defaultOutputSwitcherPath",
			Task: "defaultTaskSwitcherPath",
			Outcome: "defaultOutcomeSwitcherPath",
			Custom: "defaultCustomSwitcherPath",
		};

		const key =
			type === "Selector"
				? selectorUseageSettingsMap[this.usage]
				: switcherUseageSettingsMap[this.usage];
		const path = (this.plugin.settings[key] as string) || "";
		return path.trim();
	}

	async loadDefaultTemplate() {
		const templatePath = this.getDefaultTemplatePath(this.type);
		if (!templatePath) {
			new Notice(t("GENERATOR_VIEW_NOTICE_NO_DEFAULT"));
			return;
		}

		try {
			const file = this.app.vault.getAbstractFileByPath(templatePath);
			if (!file || !(file instanceof TFile)) {
				new Notice(
					t("GENERATOR_VIEW_NOTICE_TEMPLATE_NOT_FOUND").replace(
						"${path}",
						templatePath,
					),
				);
				return;
			}

			await this.importTemplate(file);
		} catch (error) {
			new Notice(
				t("GENERATOR_VIEW_NOTICE_LOAD_FAILED").replace(
					"${error}",
					String(error),
				),
			);
		}
	}
}
