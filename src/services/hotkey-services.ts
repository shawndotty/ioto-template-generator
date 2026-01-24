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

	static async checkHotkeyConflict(
		app: App,
		modifiers: Modifier[],
		key: string,
		ignoreCommandId?: string,
	): Promise<boolean> {
		const configDir = app.vault.configDir;
		const hotkeysPath = `${configDir}/hotkeys.json`;
		const adapter = app.vault.adapter;

		try {
			if (await adapter.exists(hotkeysPath)) {
				const content = await adapter.read(hotkeysPath);
				const hotkeysConfig: HotkeysConfig = JSON.parse(content);

				for (const cmdId in hotkeysConfig) {
					if (ignoreCommandId && cmdId === ignoreCommandId) continue;

					const entries = hotkeysConfig[cmdId];
					if (!entries) continue;
					const conflict = entries.some(
						(entry) =>
							entry.key === key &&
							entry.modifiers.length === modifiers.length &&
							entry.modifiers.every((m) => modifiers.includes(m)),
					);

					if (conflict) return true;
				}
			}
		} catch (error) {
			console.error("Failed to check hotkey conflict", error);
		}
		return false;
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
		const commandId = `templater-obsidian:${templatePath}`;
		const hotkeyManager = (app as any).hotkeyManager;
		console.dir(hotkeyManager);

		if (hotkeyManager) {
			try {
				// 1. Get existing hotkeys for this command
				let hotkeys: HotkeyEntry[] = [];
				if (
					hotkeyManager.customKeys &&
					hotkeyManager.customKeys[commandId]
				) {
					hotkeys = [...hotkeyManager.customKeys[commandId]];
				}

				// 2. Check if hotkey already exists
				const hotkeyExists = hotkeys.some(
					(entry: HotkeyEntry) =>
						entry.key === key &&
						entry.modifiers.length === modifiers.length &&
						entry.modifiers.every((m) => modifiers.includes(m)),
				);

				if (!hotkeyExists) {
					// 3. Add new hotkey
					const newHotkey = { modifiers, key };
					hotkeys.push(newHotkey);

					// 4. Update customKeys (Source of Truth for persistence)
					hotkeyManager.customKeys[commandId] = hotkeys;

					// 5. Update runtime hotkeys (if command exists)
					if (hotkeyManager.setHotkeys) {
						hotkeyManager.setHotkeys(commandId, hotkeys);
					}

					// 6. Save to disk (hotkeys.json) via Manager
					hotkeyManager.save();
					console.log(`Hotkey added for ${commandId}`);
				}
			} catch (error) {
				console.error("Failed to add hotkey via manager", error);
			}
		} else {
			console.error("HotkeyManager not available");
		}
	}
}
