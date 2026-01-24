import { App, Modal, Setting, Notice, TFile, Modifier } from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";
import { t } from "../lang/helpers";
import { IOTOTemplateGeneratorSettings } from "../settings";
import { GENERATOR_VIEW_TYPE } from "../models/constants";
import { TemplaterServices } from "../services/templater-services";
import { HotkeyService } from "../services/hotkey-services";

export class ScriptPreviewModal extends Modal {
	private script: string;
	private usage: string;
	private type: string;
	private importedFile: TFile | null;
	private settings: IOTOTemplateGeneratorSettings;
	private prefix: string;
	private folderSettings: Record<string, any>;
	private noteSettings?: Record<string, any>;

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

		new Setting(this.contentEl)
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
							let fileName = "";
							const templateUsage = t(
								this.usage as
									| "Input"
									| "Output"
									| "Task"
									| "Outcome"
									| "Custom",
							);
							if (this.type === "Selector") {
								fileName = `${this.prefix ? this.prefix + "-" : ""}TP-${t("Selector")}-${t("Create") + templateUsage}-${Date.now()}.md`;
							} else {
								fileName = `${this.prefix ? this.prefix + "-" : ""}TP-${templateUsage}-${t("Switcher")}-${t("Create")}${this.usage === "Task" ? t("TaskList") : templateUsage + t("Note")}-${Date.now()}.md`;
							}
							const folderPath =
								this.type === "Selector"
									? this.settings.selectorFolderPath || ""
									: this.settings.switcherFolderPath || "";
							const filePath = `${folderPath}/${fileName}`;

							await this.app.vault.create(filePath, content);
							new Notice(
								t("SCRIPT_PREVIEW_NOTICE_SAVED").replace(
									"${file}",
									fileName,
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
							console.dir(switchers);
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
							const hotkey = this.noteSettings?.hotkey;
							if (
								hotkey &&
								typeof hotkey === "object" &&
								hotkey.key
							) {
								try {
									const modifiers = (hotkey.modifiers || [
										"Mod",
									]) as Modifier[];
									const key = hotkey.key as string;

									// 1. Add to Templater
									const templaterService =
										new TemplaterServices(this.app);
									await templaterService.addTemplaterHotkeys([
										targetFilePath,
									]);

									// 2. Add hotkey
									await HotkeyService.addTemplaterHotkey(
										this.app,
										targetFilePath,
										modifiers,
										key,
									);
									// ...
								} catch (error) {
									// ...
								}
							}
							// ...
						}
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
