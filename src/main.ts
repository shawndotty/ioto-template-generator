import { App, Editor, MarkdownView, Modal, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	IOTOTemplateGeneratorSettings,
	SettingTab,
} from "./settings";
import { GENERATOR_VIEW_TYPE } from "./models/constants";
import { GeneratorView } from "views/GeneratorView";

// Remember to rename these classes and interfaces!

export default class IOTOTemplateGenerator extends Plugin {
	settings: IOTOTemplateGeneratorSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			GENERATOR_VIEW_TYPE,
			(leaf) => new GeneratorView(leaf, this)
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<IOTOTemplateGeneratorSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
