import { App, Modal, Setting, Notice, TFile } from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";
import { t } from "../lang/helpers";
import { IOTOTemplateGeneratorSettings } from "../settings";

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
							const switherTemplate =
								this.noteSettings?.template || "";
						}
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
