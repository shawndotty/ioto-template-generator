import { App, Modal, ButtonComponent, Notice } from "obsidian";
import { ConfigPreset, Usage } from "../types/types";
import { t } from "../lang/helpers";

class PresetDeleteConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t("PRESET_MANAGER_TITLE"));
		contentEl.addClass("preset-manager-modal");

		contentEl.createEl("p", {
			text: this.message,
			cls: "preset-confirm-message",
		});

		const footer = contentEl.createDiv({ cls: "preset-modal-footer" });

		new ButtonComponent(footer)
			.setButtonText(t("PRESET_MANAGER_BTN_CLOSE"))
			.onClick(() => this.close());

		new ButtonComponent(footer)
			.setButtonText(t("PRESET_MANAGER_BTN_DELETE"))
			.setWarning()
			.setCta()
			.onClick(() => {
				this.onConfirm();
				this.close();
			});
	}
}

export class PresetLoadModal extends Modal {
	private presets: ConfigPreset[];
	private onLoadPreset: (preset: ConfigPreset) => void;
	private onDeletePreset: (presetId: string) => void;

	constructor(
		app: App,
		presets: ConfigPreset[],
		onLoadPreset: (preset: ConfigPreset) => void,
		onDeletePreset: (presetId: string) => void,
	) {
		super(app);
		this.presets = presets;
		this.onLoadPreset = onLoadPreset;
		this.onDeletePreset = onDeletePreset;
	}

	onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass("mod-preset-manager"); // Reusing style for now
		contentEl.empty();

		this.titleEl.setText(t("PRESET_MANAGER_LOAD_TITLE"));
		contentEl.addClass("preset-manager-modal"); // Reusing style for now

		const loadSection = contentEl.createDiv({
			cls: "preset-load-section",
		});

		if (this.presets.length === 0) {
			loadSection.createEl("p", {
				text: t("PRESET_MANAGER_LOAD_EMPTY"),
				cls: "preset-empty-message",
			});
		} else {
			const presetsList = loadSection.createDiv({ cls: "presets-list" });

			// Group presets by usage
			const presetsByUsage: Record<Usage, ConfigPreset[]> = {
				Input: [],
				Output: [],
				Task: [],
				Outcome: [],
				Custom: [],
			};

			this.presets.forEach((preset) => {
				if (presetsByUsage[preset.usage]) {
					presetsByUsage[preset.usage].push(preset);
				}
			});

			Object.entries(presetsByUsage).forEach(([usage, presets]) => {
				if (presets.length === 0) return;

				const usageGroup = presetsList.createDiv({
					cls: "preset-usage-group",
				});
				usageGroup.createEl("h4", { text: usage });

				presets.forEach((preset) => {
					const presetItem = usageGroup.createDiv({
						cls: "preset-item",
					});

					const presetInfo = presetItem.createDiv({
						cls: "preset-info",
					});

					presetInfo.createEl("div", {
						text: preset.name,
						cls: "preset-name",
					});

					presetInfo.createEl("span", {
						text: preset.for,
						cls: "help-badge",
						attr: {
							style: "margin-bottom: 0px;",
						},
					});

					presetInfo.createEl("div", {
						text: new Date(preset.updatedAt).toLocaleDateString(),
						cls: "preset-date",
					});

					const presetActions = presetItem.createDiv({
						cls: "preset-actions",
					});

					const loadBtn = new ButtonComponent(presetActions);
					loadBtn
						.setButtonText(t("PRESET_MANAGER_BTN_LOAD"))
						.setCta();
					loadBtn.onClick(() => {
						this.onLoadPreset(preset);
						new Notice(
							t("PRESET_MANAGER_NOTICE_LOADED").replace(
								"${name}",
								preset.name,
							),
						);
						this.close();
					});

					const deleteBtn = new ButtonComponent(presetActions);
					deleteBtn
						.setButtonText(t("PRESET_MANAGER_BTN_DELETE"))
						.setWarning();
					deleteBtn.onClick(() => {
						const message = t(
							"PRESET_MANAGER_CONFIRM_DELETE",
						).replace("${name}", preset.name);

						new PresetDeleteConfirmModal(this.app, message, () => {
							this.onDeletePreset(preset.id);
							new Notice(
								t("PRESET_MANAGER_NOTICE_DELETED").replace(
									"${name}",
									preset.name,
								),
							);
							this.close();
						}).open();
					});
				});
			});
		}

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
