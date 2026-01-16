export type Usage = "Input" | "Output" | "Task" | "Outcome" | "Custom";
export type Level = "Folder" | "Note";
export type ValueType =
	| "string"
	| "boolean"
	| "array"
	| "file"
	| "integer"
	| "path";

export interface TemplateOption {
	name: string;
	title: string;
	for: Usage;
	level: Level;
	defaultValue: any;
	valueType: ValueType;
	description: string;
	example?: string;
}
