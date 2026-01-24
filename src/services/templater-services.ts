import { App, Notice } from "obsidian";
import { t } from "../lang/helpers";

interface TemplaterPlugin {
	settings: {
		templates_folder?: string;
		user_scripts_folder?: string;
		enabled_templates_hotkeys?: string[];
		[key: string]: any;
	};
	save_settings: () => Promise<void>;
}

export class TemplaterServices {
	constructor(private app: App) {}

	private getTemplater() {
		return this.app.plugins.plugins["templater-obsidian"] as
			| TemplaterPlugin
			| undefined;
	}

	private async getTemplaterSettings() {
		const templater = this.getTemplater();
		if (!templater) return null;

		return templater.settings || {};
	}

	async addTemplaterHotkeys(
		templatePaths: Array<string> = [],
	): Promise<boolean> {
		// 获取当前配置
		const templater = this.getTemplater();
		if (!templater) return false;
		const currentSettings = templater.settings || {};

		// 初始化enabled_templates_hotkeys数组（如果不存在）
		if (!Array.isArray(currentSettings.enabled_templates_hotkeys)) {
			currentSettings.enabled_templates_hotkeys = [];
		}

		// 添加不存在的模板路径
		let addedCount = 0;
		for (const templatePath of templatePaths) {
			if (
				!currentSettings.enabled_templates_hotkeys.includes(
					templatePath,
				)
			) {
				currentSettings.enabled_templates_hotkeys.push(templatePath);
				addedCount++;
			}
		}

		if (addedCount > 0) {
			// 保存设置
			await templater.save_settings();
			new Notice(
				`${t("ADDED")} ${addedCount} ${t(
					"TEMPLATES_TO_TEMPLATER_HOTKEYS",
				)}`,
			);
			return true;
		} else {
			new Notice(t("TEMPLATES_ALREADY_EXIST"));
			return false;
		}
	}
}
