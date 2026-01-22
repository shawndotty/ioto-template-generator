import { App, PluginSettingTab, Setting } from "obsidian";
import IOTOTemplateGenerator from "./main";
import { ConfigPreset, Usage } from "./types/types";
import { t } from "./lang/helpers";
import { TabbedSettings } from "ui/tabbed-settings";
import { FolderPickerModal } from "ui/pickers/folder-picker";
import { FilePickerModal } from "ui/pickers/file-picker";

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

	private readonly seletorSettingsMap = new Map<
		string,
		keyof IOTOTemplateGeneratorSettings
	>([
		["Input", "defaultInputSelectorPath"],
		["Output", "defaultOutputSelectorPath"],
		["Task", "defaultTaskSelectorPath"],
		["Outcome", "defaultOutcomeSelectorPath"],
		["Custom", "defaultCustomSelectorPath"],
	]);

	private readonly switcherSettingsMap = new Map<
		string,
		keyof IOTOTemplateGeneratorSettings
	>([
		["Input", "defaultInputSwitcherPath"],
		["Output", "defaultOutputSwitcherPath"],
		["Task", "defaultTaskSwitcherPath"],
		["Outcome", "defaultOutcomeSwitcherPath"],
		["Custom", "defaultCustomSwitcherPath"],
	]);

	private readonly templateTypes = [
		"Input",
		"Output",
		"Task",
		"Outcome",
		"Custom",
	];

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
						new FolderPickerModal(
							this.app,
							async (folder) => {
								this.plugin.settings.selectorFolderPath =
									folder.path;
								await this.plugin.saveSettings();
								this.currentTabIndex = 0;
								this.display();
							},
							["MyIOTO", "Templates", "Templater"],
						).open();
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
						new FolderPickerModal(
							this.app,
							async (folder) => {
								this.plugin.settings.switcherFolderPath =
									folder.path;
								await this.plugin.saveSettings();
								this.currentTabIndex = 0;
								this.display();
							},
							["MyIOTO", "Templates", "Templater"],
						).open();
					}),
			);
	}

	private getSelectorSetting(templateType: string) {
		const key = this.seletorSettingsMap.get(templateType);
		return key ? (this.plugin.settings[key] as string) || "" : "";
	}

	private setSelectorSetting(templateType: string, value: string) {
		const key = this.seletorSettingsMap.get(templateType);
		if (key) {
			(this.plugin.settings[key] as string) = value;
		}
	}

	private setSwitcherSetting(templateType: string, value: string) {
		const key = this.switcherSettingsMap.get(templateType);
		if (key) {
			(this.plugin.settings[key] as string) = value;
		}
	}

	private getSwitcherSetting(templateType: string) {
		const key = this.switcherSettingsMap.get(templateType);
		return key ? (this.plugin.settings[key] as string) || "" : "";
	}

	private renderSelectorSettings(content: HTMLElement) {
		this.templateTypes.forEach((templateType) => {
			const currentValue = this.getSelectorSetting(templateType);
			new Setting(content)
				.setName(
					`${templateType} ${t("SETTINGS_SELECTORS_FOLDER_TITLE")}`,
				)
				.setDesc(
					`${templateType} ${t("SETTINGS_SELECTORS_FOLDER_DESC")}`,
				)
				.addText((text) =>
					text
						.setPlaceholder(
							`${templateType} ${t("SETTINGS_SELECTORS_FOLDER_PLACEHOLDER")}`,
						)
						.setValue(currentValue)
						.onChange(async (value) => {
							this.setSelectorSetting(templateType, value);
							await this.plugin.saveSettings();
						}),
				)
				.addButton((btn) =>
					btn
						.setIcon("file")
						.setTooltip("Choose a file")
						.onClick(() => {
							console.log(t(templateType as any));
							new FilePickerModal(
								this.app,
								async (file) => {
									this.setSelectorSetting(
										templateType,
										file.path,
									);
									await this.plugin.saveSettings();
									this.currentTabIndex = 1;
									this.display();
								},
								[t(templateType as any), t("Selector")],
							).open();
						}),
				);
		});
	}

	private renderSwitcherSettings(content: HTMLElement) {
		this.templateTypes.forEach((templateType) => {
			const currentValue = this.getSwitcherSetting(templateType);
			new Setting(content)
				.setName(
					`${templateType} ${t("SETTINGS_SWITCHERS_FOLDER_TITLE")}`,
				)
				.setDesc(
					`${templateType} ${t("SETTINGS_SWITCHERS_FOLDER_DESC")}`,
				)
				.addText((text) =>
					text
						.setPlaceholder(
							`${templateType} ${t("SETTINGS_SWITCHERS_FOLDER_PLACEHOLDER")}`,
						)
						.setValue(currentValue)
						.onChange(async (value) => {
							this.setSwitcherSetting(templateType, value);
							await this.plugin.saveSettings();
						}),
				)
				.addButton((btn) =>
					btn
						.setIcon("file")
						.setTooltip("Choose a file")
						.onClick(() => {
							new FilePickerModal(
								this.app,
								async (file) => {
									this.setSwitcherSetting(
										templateType,
										file.path,
									);
									await this.plugin.saveSettings();
									this.currentTabIndex = 2;
									this.display();
								},
								[t(templateType as any), t("Switcher")],
							).open();
						}),
				);
		});
	}
}
