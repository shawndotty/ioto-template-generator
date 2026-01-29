import { App } from "obsidian";

export interface IotoSettings {
	// Folder paths
	inputFolder?: string;
	outputFolder?: string;
	taskFolder?: string;
	outcomeFolder?: string;
	extraFolder?: string;
	IOTOFrameworkPath?: string;

	// TDL Settings
	defaultTDLDateFormat?: string;
	defaultTDLHeadingLevel?: number;
	addLinkToCurrentTDL?: boolean;

	// Input Settings
	inputNoteNamePrefix?: string;
	inputNoteNamePostfix?: string;
	newInputNoteFollowUpAction?: number;
	addNewInputNoteToTDL?: boolean;

	// Output Settings
	outputNoteNamePrefix?: string;
	outputNoteNamePostfix?: string;
	newOutputNoteFollowUpAction?: number;
	addNewOutputNoteToTDL?: boolean;

	// Outcome Settings
	outcomeNoteNamePrefix?: string;
	outcomeNoteNamePostfix?: string;
	newOutcomeNoteFollowUpAction?: number;
	addNewOutcomeNoteToTDL?: boolean;

	// User Template
	useUserTemplate?: boolean;
	userTemplatePrefix?: string;

	// Other dynamic keys
	[key: string]: any;
}

interface IotoSettingsPlugin {
	settings: IotoSettings;
	saveSettings: () => Promise<void>;
}

export class IotoSettingsService {
	constructor(private app: App) {}

	/**
	 * Get the IOTO Settings plugin instance if available
	 */
	private getPlugin(): IotoSettingsPlugin | undefined {
		return this.app.plugins.plugins["ioto-settings"] as
			| IotoSettingsPlugin
			| undefined;
	}

	/**
	 * Check if IOTO Settings plugin is installed and enabled
	 */
	public isAvailable(): boolean {
		return !!this.getPlugin();
	}

	/**
	 * Get the current settings from IOTO Settings plugin
	 */
	public getSettings(): IotoSettings | null {
		const plugin = this.getPlugin();
		if (!plugin) return null;
		return plugin.settings || {};
	}
}
