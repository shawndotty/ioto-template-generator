import { App, PluginSettingTab, Setting } from "obsidian";
import IOTOTemplateGenerator from "./main";
import { ConfigPreset, Usage } from "./types/types";
import { t } from "./lang/helpers";
import { TabbedSettings } from "ui/tabbed-settings";
import { FolderPickerModal } from "ui/pickers/folder-picker";

export interface IOTOTemplateGeneratorSettings {
	mySetting: string;
	presets: ConfigPreset[];
	defaultInputSelectorPath: string;
	defaultOutputSelectorPath: string;
	defaultTaskSelectorPath: string;
	defaultOutcomeSelectorPath: string;
	defaultCustomSelectorPath: string;
	defaultInputSwitcherPath: string;
	defaultOutputSwitcherPath: string;
	defaultTaskSwitcherPath: string;
	defaultOutcomeSwitcherPath: string;
	defaultCustomSwitcherPath: string;
	selectorFolderPath: string;
	switcherFolderPath: string;
}

export const DEFAULT_SETTINGS: IOTOTemplateGeneratorSettings = {
	mySetting: "default",
	presets: [],
	defaultInputSelectorPath: "",
	defaultOutputSelectorPath: "",
	defaultTaskSelectorPath: "",
	defaultOutcomeSelectorPath: "",
	defaultCustomSelectorPath: "",
	defaultInputSwitcherPath: "",
	defaultOutputSwitcherPath: "",
	defaultTaskSwitcherPath: "",
	defaultOutcomeSwitcherPath: "",
	defaultCustomSwitcherPath: "",
	selectorFolderPath: "",
	switcherFolderPath: "",
};

export class SettingTab extends PluginSettingTab {
	plugin: IOTOTemplateGenerator;
	private currentTabIndex = 0;

	constructor(app: App, plugin: IOTOTemplateGenerator) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const tabbedSettings = new TabbedSettings(containerEl);

		const tabConfigs = [
			{
				title: "BASIC_SETTINGS",
				renderMethod: (content: HTMLElement) =>
					this.renderBasicSettings(content),
			},
			{
				title: "SETTINGS_SELECTORS_TITLE",
				renderMethod: (content: HTMLElement) =>
					this.renderSelectorSettings(content),
			},
			{
				title: "SETTINGS_SWITCHERS_TITLE",
				renderMethod: (content: HTMLElement) =>
					this.renderSwitcherSettings(content),
			},
		];
		tabConfigs.forEach((config) => {
			const title =
				t(config.title as any) === config.title
					? config.title
					: t(config.title as any);
			tabbedSettings.addTab(title, config.renderMethod);
		});
		tabbedSettings.activateTab(this.currentTabIndex);
	}

	private renderBasicSettings(content: HTMLElement) {
		new Setting(content)
			.setName(t("SETTINGS_SELECTORS_FOLDER_TITLE"))
			.setDesc(t("SETTINGS_SELECTORS_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder(t("SETTINGS_SELECTORS_FOLDER_PLACEHOLDER"))
					.setValue(this.plugin.settings.selectorFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.selectorFolderPath = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setIcon("folder")
					.setTooltip("Choose a folder")
					.onClick(() => {
						new FolderPickerModal(this.app, async (folder) => {
							this.plugin.settings.selectorFolderPath =
								folder.path;
							await this.plugin.saveSettings();
							this.currentTabIndex = 0;
							this.display();
						}).open();
					}),
			);

		new Setting(content)
			.setName(t("SETTINGS_SWITCHERS_FOLDER_TITLE"))
			.setDesc(t("SETTINGS_SWITCHERS_FOLDER_DESC"))
			.addText((text) =>
				text
					.setPlaceholder(t("SETTINGS_SWITCHERS_FOLDER_PLACEHOLDER"))
					.setValue(this.plugin.settings.switcherFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.switcherFolderPath = value;
						await this.plugin.saveSettings();
					}),
			)
			.addButton((btn) =>
				btn
					.setIcon("folder")
					.setTooltip("Choose a folder")
					.onClick(() => {
						new FolderPickerModal(this.app, async (folder) => {
							this.plugin.settings.switcherFolderPath =
								folder.path;
							await this.plugin.saveSettings();
							this.currentTabIndex = 0;
							this.display();
						}).open();
					}),
			);
	}

	private renderSelectorSettings(content: HTMLElement) {}

	private renderSwitcherSettings(content: HTMLElement) {}
}
