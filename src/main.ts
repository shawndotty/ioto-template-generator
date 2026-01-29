import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	WorkspaceLeaf,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	IOTOTemplateGeneratorSettings,
	SettingTab,
} from "./settings";
import { GENERATOR_VIEW_TYPE } from "./models/constants";
import { GeneratorView } from "views/GeneratorView";
import { t } from "./lang/helpers";
import { IotoSettingsService } from "services/ioto-settings-services";

// Remember to rename these classes and interfaces!

export default class IOTOTemplateGenerator extends Plugin {
	settings: IOTOTemplateGeneratorSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			GENERATOR_VIEW_TYPE,
			(leaf) => new GeneratorView(leaf, this),
		);

		this.addRibbonIcon(
			"package",
			t("MAIN_RIBBON_GENERATOR"),
			(evt: MouseEvent) => {
				if (evt.shiftKey) {
					this.activateView(true);
				} else {
					this.activateView();
				}
			},
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}

	async activateView(openInNewWindow = false) {
		const { workspace } = this.app;

		if (openInNewWindow) {
			const leaf = workspace.getLeaf("window");
			await leaf.setViewState({
				type: GENERATOR_VIEW_TYPE,
				active: true,
			});
			workspace.revealLeaf(leaf);
			return;
		}

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(GENERATOR_VIEW_TYPE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0] as WorkspaceLeaf;
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for default, or main area if preferred.
			// The user requested a main workspace leaf item view.
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: GENERATOR_VIEW_TYPE,
				active: true,
			});
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<IOTOTemplateGeneratorSettings>,
		);

		const iotoSettingsService = new IotoSettingsService(this.app);

		// 统一获取 IOTO 设置，避免重复调用
		if (iotoSettingsService.isAvailable()) {
			const iotoSettings = iotoSettingsService.getSettings();
			const base = iotoSettings?.extraFolder;
			if (base) {
				const paths = {
					selectorFolderPath: `${base}/IOTO/Templates/Templater/MyIOTO/选择器模板`,
					switcherFolderPath: `${base}/IOTO/Templates/Templater/MyIOTO/切换器模板`,
					noteTemplatesFolderPath: `${base}/IOTO/Templates/Templater/MyIOTO/笔记模板`,
				} as const;

				(Object.keys(paths) as Array<keyof typeof paths>).forEach(
					(key) => {
						if (!this.settings[key]) {
							this.settings[key] = paths[key];
						}
					},
				);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
