import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	IOTOTemplateGeneratorSettings,
	SettingTab,
} from "./settings";
import { GENERATOR_VIEW_TYPE, MAP_VIEW_TYPE } from "./models/constants";
import { GeneratorView } from "views/GeneratorView";
import { TemplateMapView } from "views/TemplateMapView";
import { t } from "./lang/helpers";
import { IotoSettingsService } from "services/ioto-settings-services";
import { ConfirmModal } from "./modals/ConfirmModal";
import { SwitcherTarget } from "./services/template-map/target";

// Remember to rename these classes and interfaces!

export default class IOTOTemplateGenerator extends Plugin {
	settings: IOTOTemplateGeneratorSettings;

	async onload() {
		try {
			await this.loadSettings();

			this.registerView(
				GENERATOR_VIEW_TYPE,
				(leaf) => new GeneratorView(leaf, this),
			);

			this.registerView(
				MAP_VIEW_TYPE,
				(leaf) => new TemplateMapView(leaf, this),
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

			// 命令入口：与功能区单击走同一条 activateView 路径
			this.addCommand({
				id: "open-generator",
				name: t("COMMAND_OPEN_GENERATOR"),
				icon: "package",
				callback: () => {
					void this.activateView();
				},
			});

			this.addCommand({
				id: "open-template-map",
				name: t("MAP_COMMAND_OPEN"),
				icon: "map",
				callback: () => {
					void this.activateMapView();
				},
			});

			// This adds a settings tab so the user can configure various aspects of the plugin
			this.addSettingTab(new SettingTab(this.app, this));
		} catch (error) {
			console.error(
				"IOTO Template Generator: Failed to load plugin",
				error,
			);
			new Notice(
				"IOTO Template Generator: Failed to load plugin. Check console for details.",
			);
		}
	}

	onunload() {}

	async activateView(openInNewWindow = false): Promise<GeneratorView | null> {
		const leaf = await this.revealOrCreate(
			GENERATOR_VIEW_TYPE,
			openInNewWindow,
		);
		return leaf?.view instanceof GeneratorView ? leaf.view : null;
	}

	async activateMapView(openInNewWindow = false) {
		await this.revealOrCreate(MAP_VIEW_TYPE, openInNewWindow);
	}

	/**
	 * 模板地图的编辑图标入口：复用已有生成器 leaf，载入切换器并定位到目标行。
	 * 全程不写 vault（保存仍由用户在生成器里点）。
	 */
	async openSwitcherEditor(file: TFile, target: SwitcherTarget): Promise<void> {
		if (!file) return;

		const view = await this.activateView();
		if (!view) {
			new Notice(t("MAP_EDIT_OPEN_FAILED"));
			return;
		}

		if (view.hasUnsavedChanges()) {
			const proceed = await this.confirmOverwrite(file);
			if (!proceed) return;
		}

		const ok = await view.importTemplate(file, "Switcher");
		if (!ok) return; // importTemplate 已弹过失败原因

		view.focusSwitcherTarget(target);
	}

	private confirmOverwrite(file: TFile): Promise<boolean> {
		return new Promise((resolve) => {
			new ConfirmModal(
				this.app,
				t("MAP_EDIT_DIRTY_TITLE"),
				t("MAP_EDIT_DIRTY_MESSAGE", { file: file.basename }),
				resolve,
			).open();
		});
	}

	/** 找已有 leaf -> 没有就新建 -> reveal；两个视图入口共用。 */
	private async revealOrCreate(
		type: string,
		openInNewWindow = false,
	): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;

		if (openInNewWindow) {
			const leaf = workspace.getLeaf("window");
			await leaf.setViewState({ type, active: true });
			workspace.revealLeaf(leaf);
			return leaf;
		}

		let leaf: WorkspaceLeaf | null =
			workspace.getLeavesOfType(type)[0] ?? null;

		if (!leaf) {
			// 用户要求主工作区的 tab 视图
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
		return leaf;
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			loadedData as Partial<IOTOTemplateGeneratorSettings>,
		);

		// Only load from IOTO Settings if data.json does not exist (fresh install)
		if (!loadedData) {
			const iotoSettingsService = new IotoSettingsService(this.app);

			// 统一获取 IOTO 设置，避免重复调用
			try {
				if (iotoSettingsService.isAvailable()) {
					const iotoSettings = iotoSettingsService.getSettings();
					const base = iotoSettings?.extraFolder;
					if (base) {
						const paths = {
							selectorFolderPath: `${base}/IOTO/Templates/Templater/MyIOTO/${t("SELECTOR_FOLDER_NAME")}`,
							switcherFolderPath: `${base}/IOTO/Templates/Templater/MyIOTO/${t("SWITCHER_FOLDER_NAME")}`,
							noteTemplatesFolderPath: `${base}/IOTO/Templates/Templater/MyIOTO/${t("NOTE_TEMPLATES_FOLDER_NAME")}`,
						} as const;

						(
							Object.keys(paths) as Array<keyof typeof paths>
						).forEach((key) => {
							if (!this.settings[key]) {
								this.settings[key] = paths[key];
							}
						});
					}
				}
			} catch (error) {
				console.warn(
					"IOTO Template Generator: Failed to load IOTO Settings",
					error,
				);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
