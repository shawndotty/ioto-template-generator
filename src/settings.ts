import { App, PluginSettingTab, Setting } from "obsidian";
import IOTOTemplateGenerator from "./main";
import { ConfigPreset, Usage } from "./types/types";

export interface IOTOTemplateGeneratorSettings {
	mySetting: string;
	presets: ConfigPreset[];
	defaultInputTemplatePath: string;
	defaultOutputTemplatePath: string;
	defaultTaskTemplatePath: string;
	defaultOutcomeTemplatePath: string;
	defaultCustomTemplatePath: string;
}

export const DEFAULT_SETTINGS: IOTOTemplateGeneratorSettings = {
	mySetting: "default",
	presets: [],
	defaultInputTemplatePath: "",
	defaultOutputTemplatePath: "",
	defaultTaskTemplatePath: "",
	defaultOutcomeTemplatePath: "",
	defaultCustomTemplatePath: "",
};

export class SettingTab extends PluginSettingTab {
	plugin: IOTOTemplateGenerator;

	constructor(app: App, plugin: IOTOTemplateGenerator) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
	}
}
