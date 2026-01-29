import {
	App,
	Modal,
	Setting,
	Notice,
	TFile,
	Modifier,
	Platform,
	ButtonComponent,
} from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";
import { t } from "../lang/helpers";
import { IOTOTemplateGeneratorSettings } from "../settings";
import { GENERATOR_VIEW_TYPE } from "../models/constants";
import { TemplaterServices } from "../services/templater-services";
import { HotkeyService, HotkeyEntry } from "../services/hotkey-services";

export class ScriptPreviewModal extends Modal {
	private script: string;
	private usage: string;
	private type: string;
	private importedFile: TFile | null;
	private settings: IOTOTemplateGeneratorSettings;
	private prefix: string;
	private folderSettings: Record<string, any>;
	private noteSettings?: Record<string, any>;
	private templateName: string;
	private targetFilePath: string;
	private hotkey?: HotkeyEntry | null;
	private isRecordingHotkey = false;
	private hotkeyBtn: ButtonComponent;

	constructor(
		app: App,
		settings: IOTOTemplateGeneratorSettings,
		script: string,
		usage: string,
		type: string,
		importedFile: TFile | null,
		folderSettings: Record<string, any>,
		noteSettings?: Record<string, any>,
	) {
		super(app);
		this.script = script;
		this.usage = usage;
		this.type = type;
		this.importedFile = importedFile;
		this.settings = settings;
		this.prefix =
			this.app.plugins.plugins["ioto-settings"].settings
				.userTemplatePrefix || "";
		this.folderSettings = folderSettings;
		this.noteSettings = noteSettings;

		this.makeTemplateName();
		this.makeTargetFilePath();
		if (this.importedFile) {
			HotkeyService.getTemplaterHotkey(
				this.app,
				this.importedFile.path,
			).then((hk) => {
				this.hotkey = hk;
				this.updateHotkeyButton();
			});
		}
	}

	makeTemplateName() {
		if (this.importedFile) {
			this.templateName = `${this.importedFile.basename}`;
		} else {
			const templateUsage = t(
				this.usage as
					| "Input"
					| "Output"
					| "Task"
					| "Outcome"
					| "Custom",
			);
			let prefix = this.prefix ? this.prefix + "-" : "";
			if (this.type === "Selector") {
				this.templateName = `${prefix}TP-${t("Selector")}-${t("Create") + templateUsage}-${Date.now()}`;
			} else {
				this.templateName = `${prefix}-${templateUsage}-${t("Switcher")}-${t("Create")}${this.usage === "Task" ? t("TaskList") : templateUsage + t("Note")}-${Date.now()}`;
			}
		}
	}

	makeTargetFilePath() {
		if (this.importedFile) {
			this.targetFilePath = this.importedFile.path;
		} else {
			const folderPath =
				this.type === "Selector"
					? this.settings.selectorFolderPath || ""
					: this.settings.switcherFolderPath || "";
			this.targetFilePath = `${folderPath}/${this.templateName}.md`;
		}
	}

	onOpen() {
		this.modalEl.addClass("mod-script-preview");
		this.titleEl.setText(
			`${t("SCRIPT_PREVIEW_TITLE")} - ${this.type} - ${this.usage}`,
		);

		const editorContainer = this.contentEl.createDiv({
			cls: "script-editor-container",
		});

		const state = EditorState.create({
			doc: this.script,
			extensions: [
				keymap.of(defaultKeymap),
				javascript(),
				oneDark,
				EditorView.lineWrapping,
			],
		});

		const view = new EditorView({
			state,
			parent: editorContainer,
		});

		const previewSetting = new Setting(this.contentEl);

		if (!this.importedFile) {
			previewSetting.addText(
				(text) =>
					(text
						.setPlaceholder(this.templateName)
						.setValue(this.templateName)
						.onChange((value) => {
							this.templateName = value;
							this.makeTargetFilePath();
						}).inputEl.style.width = "100%"),
			);
		}

		if (this.type === "Selector") {
			previewSetting.addButton((btn) => {
				this.hotkeyBtn = btn;
				this.updateHotkeyButton();
				btn.onClick(() => this.toggleHotkeyRecording());
			});
		}
		previewSetting
			.addButton((btn) => {
				btn.setButtonText(t("SCRIPT_PREVIEW_BTN_MAXIMIZE")).onClick(
					() => {
						if (this.modalEl.hasClass("is-maximized")) {
							this.modalEl.removeClass("is-maximized");
							btn.setButtonText(t("SCRIPT_PREVIEW_BTN_MAXIMIZE"));
						} else {
							this.modalEl.addClass("is-maximized");
							btn.setButtonText(t("SCRIPT_PREVIEW_BTN_RESTORE"));
						}
					},
				);
			})
			.addButton((btn) => {
				btn.setButtonText(t("SCRIPT_PREVIEW_BTN_COPY")).onClick(() => {
					const content = view.state.doc.toString();
					navigator.clipboard.writeText(content);
					new Notice(t("SCRIPT_PREVIEW_NOTICE_COPIED"));
				});
			})
			.addButton((btn) => {
				const label = this.importedFile
					? t("SCRIPT_PREVIEW_BTN_UPDATE").replace(
							"${file}",
							this.importedFile.basename,
						)
					: t("SCRIPT_PREVIEW_BTN_SAVE_AS");
				btn.setButtonText(label)
					.setCta()
					.onClick(async () => {
						const content = view.state.doc.toString();

						if (this.importedFile) {
							await this.app.vault.modify(
								this.importedFile,
								content,
							);
							new Notice(
								t("SCRIPT_PREVIEW_NOTICE_UPDATED").replace(
									"${path}",
									this.importedFile.path,
								),
							);
						} else {
							await this.app.vault.create(
								this.targetFilePath,
								content,
							);
							new Notice(
								t("SCRIPT_PREVIEW_NOTICE_SAVED").replace(
									"${file}",
									this.templateName,
								),
							);
						}
						this.close();

						if (this.type === "Selector") {
							const switcherTemplateName =
								this.noteSettings?.template || "";
							if (!switcherTemplateName) return;

							const existingFile =
								this.app.metadataCache.getFirstLinkpathDest(
									switcherTemplateName,
									"",
								);
							if (existingFile) return;

							const switcherFolderPath =
								this.settings.switcherFolderPath || "";
							if (
								switcherFolderPath &&
								!(await this.app.vault.adapter.exists(
									switcherFolderPath,
								))
							) {
								await this.app.vault.createFolder(
									switcherFolderPath,
								);
							}

							const fileName = `${switcherTemplateName}.md`;
							const filePath = switcherFolderPath
								? `${switcherFolderPath}/${fileName}`
								: fileName;
							const content = `<%*\n/*\n** type: switcher\n** for: ${this.usage}\n*/\n_%>\n\n<%*\n\nconst frontMatter = {};\n\nconst switchers = [];\n\n_%>`;

							try {
								const newFile = await this.app.vault.create(
									filePath,
									content,
								);
								new Notice(
									t("SWITCHER_TEMPLATE_CREATED").replace(
										"${file}",
										fileName,
									),
								);

								// Auto import into GeneratorView
								const leaf =
									this.app.workspace.getLeavesOfType(
										GENERATOR_VIEW_TYPE,
									)?.[0];
								if (leaf) {
									const view = leaf.view as any;
									if (
										typeof view?.importTemplate ===
										"function"
									) {
										view.importTemplate(newFile);
									}
								}
							} catch (error) {
								console.error(
									"Failed to create switcher template",
									error,
								);
								new Notice(
									t(
										"SWITCHER_TEMPLATE_CREATE_FAILED",
									).replace(
										"${error}",
										error instanceof Error
											? error.message
											: "Unknown error",
									),
								);
							}
						}

						if (this.type === "Switcher") {
							const switchers =
								this.folderSettings?.switchers || [];
							if (switchers.length) {
								// 并行创建缺失的 note 模板
								await Promise.all(
									switchers.map(
										async ({
											template,
										}: {
											template: string;
										}) => {
											if (!template) return;
											const exists =
												this.app.metadataCache.getFirstLinkpathDest(
													template,
													"",
												);
											if (exists) return;

											const dir =
												this.settings
													.noteTemplatesFolderPath ||
												"";
											if (
												dir &&
												!(await this.app.vault.adapter.exists(
													dir,
												))
											) {
												await this.app.vault.createFolder(
													dir,
												);
											}

											const fileName = `${template}.md`;
											const filePath = dir
												? `${dir}/${fileName}`
												: fileName;

											try {
												await this.app.vault.create(
													filePath,
													"",
												);
												new Notice(
													t(
														"NOTE_TEMPLATE_CREATED",
													).replace(
														"${file}",
														fileName,
													),
												);
											} catch (err) {
												console.error(
													"Failed to create note template",
													err,
												);
												new Notice(
													t(
														"NOTE_TEMPLATE_CREATE_FAILED",
													).replace(
														"${error}",
														err instanceof Error
															? err.message
															: "Unknown error",
													),
												);
											}
										},
									),
								);
							}
						}

						if (this.type === "Selector") {
							// Try to add hotkey if configured
							const hotkey = this.hotkey;
							if (
								hotkey &&
								typeof hotkey === "object" &&
								hotkey.key
							) {
								try {
									const modifiers = (hotkey.modifiers || [
										"Alt",
									]) as Modifier[];
									const key = hotkey.key as string;

									// 1. Add to Templater
									const templaterService =
										new TemplaterServices(this.app);
									await templaterService.addTemplaterHotkeys([
										this.targetFilePath,
									]);

									// 2. Add hotkey
									await HotkeyService.addTemplaterHotkey(
										this.app,
										this.targetFilePath,
										modifiers,
										key,
									);
								} catch (error) {
									console.error(
										"Failed to add hotkey",
										error,
									);
								}
							}
						}
					});
			});

		previewSetting.infoEl.hide();
	}

	updateHotkeyButton() {
		if (!this.hotkeyBtn) return;

		const btnEl = this.hotkeyBtn.buttonEl;
		btnEl.removeClass("mod-warning");

		if (this.isRecordingHotkey) {
			this.hotkeyBtn.setButtonText(t("SCRIPT_PREVIEW_BTN_PRESS_HOTKEY"));
			this.hotkeyBtn.setCta();
		} else if (this.hotkey) {
			const modifiers = this.hotkey.modifiers.join("+");
			const key = this.hotkey.key.toUpperCase();
			this.hotkeyBtn.setButtonText(`${modifiers}+${key}`);
			this.hotkeyBtn.removeCta();
		} else {
			this.hotkeyBtn.setButtonText(t("SCRIPT_PREVIEW_BTN_ADD_HOTKEY"));
			this.hotkeyBtn.removeCta();
		}
	}

	toggleHotkeyRecording() {
		if (this.isRecordingHotkey) {
			this.stopRecording();
		} else {
			this.startRecording();
		}
	}

	startRecording() {
		this.isRecordingHotkey = true;
		this.updateHotkeyButton();
		document.addEventListener("keydown", this.handleKeyDown);
	}

	stopRecording() {
		this.isRecordingHotkey = false;
		document.removeEventListener("keydown", this.handleKeyDown);
		this.updateHotkeyButton();
	}

	handleKeyDown = async (e: KeyboardEvent) => {
		e.preventDefault();
		e.stopPropagation();

		if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

		const finalModifiers: Modifier[] = [];

		if (Platform.isMacOS) {
			if (e.metaKey) finalModifiers.push("Mod");
			if (e.ctrlKey) finalModifiers.push("Ctrl");
			if (e.altKey) finalModifiers.push("Alt");
			if (e.shiftKey) finalModifiers.push("Shift");
		} else {
			if (e.ctrlKey) finalModifiers.push("Mod");
			if (e.metaKey) finalModifiers.push("Meta");
			if (e.altKey) finalModifiers.push("Alt");
			if (e.shiftKey) finalModifiers.push("Shift");
		}

		let key = e.key.toUpperCase();

		// Handle Alt+Key behavior on macOS where it produces special characters
		if (e.code.startsWith("Digit")) {
			key = e.code.replace("Digit", "");
		} else if (e.code.startsWith("Key")) {
			key = e.code.replace("Key", "");
		} else if (e.code.startsWith("Numpad")) {
			key = e.code.replace("Numpad", "");
		} else if (e.code === "Minus") {
			key = "-";
		} else if (e.code === "Equal") {
			key = "=";
		} else if (e.code === "BracketLeft") {
			key = "[";
		} else if (e.code === "BracketRight") {
			key = "]";
		} else if (e.code === "Backslash") {
			key = "\\";
		} else if (e.code === "Semicolon") {
			key = ";";
		} else if (e.code === "Quote") {
			key = "'";
		} else if (e.code === "Comma") {
			key = ",";
		} else if (e.code === "Period") {
			key = ".";
		} else if (e.code === "Slash") {
			key = "/";
		} else if (e.code === "Backquote") {
			key = "`";
		}

		const conflict = await HotkeyService.checkHotkeyConflict(
			this.app,
			finalModifiers,
			key,
			`templater-obsidian:${this.targetFilePath}`,
		);

		if (conflict) {
			this.hotkey = { modifiers: finalModifiers, key };
			this.stopRecording();
			this.hotkeyBtn.buttonEl.addClass("mod-warning");
			new Notice(t("SCRIPT_PREVIEW_HOTKEY_CONFLICT"));
		} else {
			this.hotkey = { modifiers: finalModifiers, key };
			this.stopRecording();
		}
	};

	onClose() {
		document.removeEventListener("keydown", this.handleKeyDown);
		this.contentEl.empty();
	}
}
