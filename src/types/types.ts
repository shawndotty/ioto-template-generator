export type TemplateType = "Selector" | "Switcher";
export type Usage = "Input" | "Output" | "Task" | "Outcome" | "Custom";
export type Level = "Folder" | "Note";
export type ValueType =
	| "string"
	| "boolean"
	| "array"
	| "object"
	| "file"
	| "integer"
	| "path";
declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(id: string): void;
		};
		plugins: {
			plugins: {
				[key: string]: any;
			};
		};
		dom: {
			appContainerEl: HTMLElement;
		};
	}
}
export interface TemplateOption {
	name: string;
	title: string;
	type: TemplateType;
	for: Usage;
	order: number;
	level: Level;
	defaultValue: any;
	valueType: ValueType;
	asSelector?: boolean;
	choices?: { label: string; value: any }[];
	description: string;
	example?: string;
	imageExplain?: string;
}

export interface ConfigPreset {
	id: string;
	name: string;
	usage: Usage;
	for: TemplateType;
	folderSettings: Record<string, string>;
	noteSettings?: Record<string, any>;
	createdAt: number;
	updatedAt: number;
}

export interface TemplateGeneratorSettings {
	usage: Usage;
	for: TemplateType;
	folderSettings: Record<string, string>;
	noteSettings?: Record<string, any>;
}
