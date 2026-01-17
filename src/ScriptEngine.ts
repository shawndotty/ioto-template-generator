import { Usage } from "./types/types";
import { TEMPLATE_OPTIONS, IOTO_VARIABLES } from "./models/constants";
import { Notice } from "obsidian";

export class ScriptEngine {
	static parse(content: string): {
		usage: Usage | null;
		folderSettings: Record<string, any>;
		noteSettings: Record<string, any>;
	} {
		let usage: Usage | null = null;
		let folderSettings: Record<string, string> = {};
		let noteSettings: Record<string, any> = {};
		return {
			usage,
			folderSettings,
			noteSettings,
		};
	}

	static generate(
		usage: Usage,
		folderSettings: Record<string, any>,
		noteSettings: Record<string, any>
	): string {
		let templates = "";
		const usedFor = usage?.toLowerCase();
		const iotoVariables = IOTO_VARIABLES[usedFor];
		return "";
	}
}
