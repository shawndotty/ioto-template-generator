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
import { IotoSettingsService } from "../services/ioto-settings-services";
import {
	TEMPLATE_KIND_FOLDER_KEY,
	TemplateKind,
	normalizePrefix,
	resolveTemplateFolder,
} from "../services/template-path-services";
import { HotkeyService, HotkeyEntry } from "../services/hotkey-services";
import { createEmptySwitcherContent } from "../processors/switcherTemplate";
// 仅类型断言用：运行时 import 会与 GeneratorView 形成循环依赖
import type { GeneratorView } from "../views/GeneratorView";

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
	/** 文件名下方的「保存到」提示；错分流是静默的，必须让人看得见落点。 */
	private targetHintEl: HTMLElement | null = null;
	/** 覆盖保存成功后的回调：调用方用它刷新「脏检查」基线。 */
	private onSaved?: () => void;

	constructor(
		app: App,
		settings: IOTOTemplateGeneratorSettings,
		script: string,
		usage: string,
		type: string,
		importedFile: TFile | null,
		folderSettings: Record<string, any>,
		noteSettings?: Record<string, any>,
		onSaved?: () => void,
	) {
		super(app);
		this.script = script;
		this.usage = usage;
		this.type = type;
		this.importedFile = importedFile;
		this.settings = settings;
		this.onSaved = onSaved;
		// 仅用于拼默认文件名；真正的落点判定在保存那一刻重新读前缀
		this.prefix = new IotoSettingsService(this.app).getUserTemplatePrefix();
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
				this.templateName = `${prefix}TP-${templateUsage}-${t("Switcher")}-${t("Create")}${this.usage === "Task" ? t("TaskList") : templateUsage + t("Note")}-${Date.now()}`;
			}
		}
	}

	/** 仅选择器/切换器两种弹窗类型能走到这里；笔记模板由切换器规则各自的 kind 处理。 */
	private currentKind(): TemplateKind {
		return this.type === "Selector" ? "Selector" : "Switcher";
	}

	/**
	 * 按「文件名的最终形态」决定落到哪个目录。
	 * 前缀在每次调用时现读 ioto-settings —— 弹窗打开后用户改了前缀也不会错。
	 */
	private resolveFolder(kind: TemplateKind, name: string): string {
		const configured =
			kind === "Note"
				? this.settings.noteTemplatesFolderPath
				: kind === "Switcher"
					? this.settings.switcherFolderPath
					: this.settings.selectorFolderPath;
		const iotoSettings = new IotoSettingsService(this.app);

		return resolveTemplateFolder({
			name,
			kind,
			prefix: normalizePrefix(iotoSettings.getUserTemplatePrefix()),
			configuredFolder: configured || "",
			templaterRoot: new TemplaterServices(this.app).getTemplatesFolder(),
			frameworkRoot: iotoSettings.getFrameworkPath(),
			kindFolderName: t(TEMPLATE_KIND_FOLDER_KEY[kind]),
		});
	}

	makeTargetFilePath() {
		if (this.importedFile) {
			this.targetFilePath = this.importedFile.path;
		} else {
			const folderPath = this.resolveFolder(
				this.currentKind(),
				this.templateName,
			).replace(/\/+$/, "");
			this.targetFilePath = folderPath
				? `${folderPath}/${this.templateName}.md`
				: `${this.templateName}.md`;
		}
		this.updateTargetHint();
	}

	private updateTargetHint() {
		if (!this.targetHintEl || this.importedFile) return;
		this.targetHintEl.setText(
			`${t("SCRIPT_PREVIEW_SAVE_TO")}${this.targetFilePath}`,
		);
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
			this.targetHintEl = this.contentEl.createDiv({
				cls: "ioto-tg-target-hint",
			});
			this.updateTargetHint();
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
							this.onSaved?.();
						} else {
							// 保存这一刻重算：文件名可能刚被改过，前缀也可能刚被改过
							this.makeTargetFilePath();
							await ensureFolder(
								this.app,
								parentFolderOf(this.targetFilePath),
							);
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

						// Add Hotkey
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

						// Create Switcher Template
						if (this.type === "Selector") {
							const switcherTemplateName =
								this.noteSettings?.template || "";
							console.log(switcherTemplateName);
							if (
								!switcherTemplateName ||
								switcherTemplateName === "${switcherTemplate}"
							)
								return;

							const existingFile =
								this.app.metadataCache.getFirstLinkpathDest(
									switcherTemplateName,
									"",
								);
							if (existingFile) return;

							// 切换器模板同样按最终文件名分流，并逐级建目录
							const switcherFolderPath = this.resolveFolder(
								"Switcher",
								switcherTemplateName,
							).replace(/\/+$/, "");
							await ensureFolder(this.app, switcherFolderPath);

							const fileName = `${switcherTemplateName}.md`;
							const filePath = switcherFolderPath
								? `${switcherFolderPath}/${fileName}`
								: fileName;
							const content = createEmptySwitcherContent(
								this.usage,
							);

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
									// 只做类型断言，不产生运行时依赖
									const view =
										leaf.view as unknown as GeneratorView;
									if (
										typeof view?.importTemplate ===
										"function"
									) {
										// 视图此刻通常还停在 Selector 页：必须声明这是切换器，
										// 否则会被 parseSelector 判成缺 folderSettings 而整份失败
										await view.importTemplate(
											newFile,
											"Switcher",
										);
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

						// Edit Switcher Template
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
											if (
												!template ||
												template.includes("${")
											)
												return;
											const exists =
												this.app.metadataCache.getFirstLinkpathDest(
													template,
													"",
												);
											if (exists) return;

											// 每条规则各自判定：同一次保存里 JL- 进 JLIOTO、
											// My- 仍进 MyIOTO
											const dir = this.resolveFolder(
												"Note",
												template,
											).replace(/\/+$/, "");
											await ensureFolder(this.app, dir);

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
		this.contentEl.ownerDocument.addEventListener(
			"keydown",
			this.handleKeyDown,
		);
	}

	stopRecording() {
		this.isRecordingHotkey = false;
		this.contentEl.ownerDocument.removeEventListener(
			"keydown",
			this.handleKeyDown,
		);
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
		this.contentEl.ownerDocument.removeEventListener(
			"keydown",
			this.handleKeyDown,
		);
		this.contentEl.empty();
		this.targetHintEl = null;
	}
}

/** 目录部分；根目录下的文件返回空串。 */
function parentFolderOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index > 0 ? path.slice(0, index) : "";
}

/**
 * 逐级建目录：`createFolder` 不会递归建父目录，
 * `<前缀>IOTO/笔记模板` 首次保存时两级都不存在。
 */
async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = folder.replace(/^\/+|\/+$/g, "");
	if (!path) return;

	let current = "";
	for (const segment of path.split("/")) {
		if (!segment) continue;
		current = current ? `${current}/${segment}` : segment;
		if (await app.vault.adapter.exists(current)) continue;
		try {
			await app.vault.createFolder(current);
		} catch (error) {
			// 并发保存可能同时建同一层：确实是「刚被别人建好」才吞掉
			if (!(await app.vault.adapter.exists(current))) throw error;
		}
	}
}
