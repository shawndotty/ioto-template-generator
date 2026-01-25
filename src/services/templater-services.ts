import { App, Notice, TFile } from "obsidian";
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
		const newPaths: string[] = [];
		for (const templatePath of templatePaths) {
			if (
				!currentSettings.enabled_templates_hotkeys.includes(
					templatePath,
				)
			) {
				currentSettings.enabled_templates_hotkeys.push(templatePath);
				newPaths.push(templatePath);
				addedCount++;
			}
		}

		if (addedCount > 0) {
			// 保存设置
			await templater.save_settings();

			// Manually register commands for new templates to avoid reload
			for (const path of newPaths) {
				this.registerTemplaterCommand(path);
			}

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

	private registerTemplaterCommand(templatePath: string) {
		const templater = this.getTemplater();
		if (!templater) return;

		const commandId = `templater-obsidian:${templatePath}`;
		// Check if command already exists
		if ((this.app as any).commands.findCommand(commandId)) return;

		// Use the plugin's addCommand to ensure correct ID prefix and context
		(templater as any).addCommand({
			id: templatePath,
			name: `Insert ${templatePath}`,
			callback: async () => {
				const core = (templater as any).templater;
				if (core) {
					const file =
						this.app.vault.getAbstractFileByPath(templatePath);
					if (file instanceof TFile) {
						if (core.write_template_to_active_file) {
							await core.write_template_to_active_file(file);
						} else if (core.append_template_to_active_file) {
							await core.append_template_to_active_file(file);
						} else {
							// Fallback or log if method name is different
							console.warn(
								"Templater execution method not found",
							);
						}
					}
				}
			},
		});
	}
}
