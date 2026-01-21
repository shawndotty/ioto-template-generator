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
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
