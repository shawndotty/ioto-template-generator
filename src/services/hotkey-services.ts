import { App, Modifier } from "obsidian";

export interface HotkeyEntry {
	modifiers: Modifier[];
	key: string;
}

interface HotkeysConfig {
	[commandId: string]: HotkeyEntry[];
}

export class HotkeyService {
	/**
	 * Gets the hotkey for a Templater template from hotkeys.json
	 * @param app The Obsidian App instance
	 * @param templatePath The path to the template file (relative to vault root)
	 * @returns The first hotkey found or null if none exists
	 */
	static async getTemplaterHotkey(
		app: App,
		templatePath: string,
	): Promise<HotkeyEntry | null> {
		const configDir = app.vault.configDir;
		const hotkeysPath = `${configDir}/hotkeys.json`;
		const adapter = app.vault.adapter;

		try {
			if (await adapter.exists(hotkeysPath)) {
				const content = await adapter.read(hotkeysPath);
				const hotkeysConfig: HotkeysConfig = JSON.parse(content);

				const commandId = `templater-obsidian:${templatePath}`;

				console.dir(commandId);

				if (
					hotkeysConfig[commandId] &&
					hotkeysConfig[commandId].length > 0
				) {
					return hotkeysConfig[commandId][0] || null;
				}
			}
		} catch (error) {
			console.error("Failed to read hotkeys.json", error);
		}

		return null;
	}

	/**
	 * Adds or updates a hotkey for a Templater template in hotkeys.json
	 * @param app The Obsidian App instance
	 * @param templatePath The path to the template file (relative to vault root)
	 * @param modifiers Array of modifiers (e.g., ["Mod", "Shift"])
	 * @param key The key to trigger the command
	 */
	static async addTemplaterHotkey(
		app: App,
		templatePath: string,
		modifiers: Modifier[],
		key: string,
	): Promise<void> {
		const configDir = app.vault.configDir;
		const hotkeysPath = `${configDir}/hotkeys.json`;
		const adapter = app.vault.adapter;

		let hotkeysConfig: HotkeysConfig = {};

		try {
			if (await adapter.exists(hotkeysPath)) {
				const content = await adapter.read(hotkeysPath);
				hotkeysConfig = JSON.parse(content);
			}
		} catch (error) {
			console.error("Failed to read hotkeys.json", error);
			throw error;
		}

		// Construct the command ID for Templater
		// Format: templater-obsidian:<template_path>
		const commandId = `templater-obsidian:${templatePath}`;

		if (!hotkeysConfig[commandId]) {
			hotkeysConfig[commandId] = [];
		}

		// Check if the hotkey already exists for this command
		const hotkeyExists = hotkeysConfig[commandId].some((entry) => {
			return (
				entry.key === key &&
				entry.modifiers.length === modifiers.length &&
				entry.modifiers.every((m) => modifiers.includes(m))
			);
		});

		if (!hotkeyExists) {
			hotkeysConfig[commandId].push({
				modifiers: modifiers,
				key: key,
			});

			try {
				await adapter.write(
					hotkeysPath,
					JSON.stringify(hotkeysConfig, null, 2),
				);
			} catch (error) {
				console.error("Failed to write hotkeys.json", error);
				throw error;
			}
		}
	}
}
