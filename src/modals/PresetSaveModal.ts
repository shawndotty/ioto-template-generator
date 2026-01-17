import {
	App,
	Modal,
	ButtonComponent,
	TextComponent,
	Notice,
	DropdownComponent,
} from "obsidian";
import { ConfigPreset, Usage, TemplateGeneratorSettings } from "../types/types";
import { t } from "../lang/helpers";

export class PresetSaveModal extends Modal {
	private presets: ConfigPreset[];
	private onSavePreset: (preset: ConfigPreset) => void;
	private currentSettings: TemplateGeneratorSettings;

	constructor(
		app: App,
		presets: ConfigPreset[],
		currentSettings: TemplateGeneratorSettings,
		onSavePreset: (preset: ConfigPreset) => void
	) {
		super(app);
		this.presets = presets;
		this.currentSettings = currentSettings;
		this.onSavePreset = onSavePreset;
	}

	onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass("mod-preset-manager"); // Reusing style for now
		contentEl.empty();
		this.titleEl.setText(t("PRESET_MANAGER_SAVE_TITLE"));
		contentEl.addClass("preset-manager-modal"); // Reusing style for now

		const saveSection = contentEl.createDiv({
			cls: "preset-save-section",
		});

		const saveContainer = saveSection.createDiv({
			cls: "preset-save-form",
		});
		const nameInput = new TextComponent(saveContainer);
		nameInput.inputEl.style.width = "100%";
		nameInput.inputEl.style.marginBottom = "10px";
		nameInput.setPlaceholder(t("PRESET_MANAGER_SAVE_PLACEHOLDER"));

		const usageDropdown = new DropdownComponent(saveContainer);
		usageDropdown.selectEl.style.width = "100%";
		usageDropdown.selectEl.style.marginBottom = "10px";
		const usages: Usage[] = [
			"Input",
			"Output",
			"Task",
			"Outcome",
			"Custom",
		];
		usageDropdown.addOptions(Object.fromEntries(usages.map((p) => [p, p])));
		usageDropdown.setValue(this.currentSettings.usage);

		const saveButton = new ButtonComponent(saveContainer);
		saveButton.setButtonText(t("PRESET_MANAGER_SAVE_BTN")).setCta();
		saveButton.onClick(() => {
			const name = nameInput.getValue().trim();
			if (!name) {
				new Notice(t("PRESET_MANAGER_NOTICE_ENTER_NAME"));
				return;
			}

			// Check for duplicate name
			if (this.presets.some((p) => p.name === name)) {
				new Notice(t("PRESET_MANAGER_NOTICE_DUPLICATE"));
				return;
			}

			const preset: ConfigPreset = {
				id: Math.random().toString(36).substr(2, 9),
				name,
				usage: usageDropdown.getValue() as Usage,
				folderSettings: { ...this.currentSettings.folderSettings },
				noteSettings: { ...this.currentSettings.noteSettings },
				// Deep copy
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};

			this.onSavePreset(preset);
			new Notice(
				t("PRESET_MANAGER_NOTICE_SAVED").replace("${name}", name)
			);
			this.close();
		});

		// Footer
		// const footer = contentEl.createDiv({ cls: "preset-modal-footer" });
		// new ButtonComponent(footer)
		// 	.setButtonText(t("PRESET_MANAGER_BTN_CLOSE"))
		// 	.onClick(() => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
