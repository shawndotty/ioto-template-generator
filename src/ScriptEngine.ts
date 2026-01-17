import { Usage } from "./types/types";
import {
	TEMPLATE_OPTIONS,
	IOTO_VARIABLES,
	IOTO_NOTE_TEMPLATES,
	IOTO_ML,
} from "./models/constants";
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
		noteSettings: Record<string, any>,
	): string {
		let templates = "";
		const usedFor = usage?.toLowerCase();
		const iotoVariables = usedFor
			? IOTO_VARIABLES[usedFor as keyof typeof IOTO_VARIABLES]
			: "";

		const iotoNoteTemplate = usedFor
			? IOTO_NOTE_TEMPLATES[usedFor as keyof typeof IOTO_NOTE_TEMPLATES]
			: "";

		templates += iotoVariables + "\n\n";

		templates += IOTO_ML + "\n\n";

		templates += `const ${usedFor}sFolderSettings = {\n`;

		const folderOptions = TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Folder" && o.for === usage,
		);

		folderOptions.forEach((opt) => {
			const userVal = folderSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			if (userVal && userVal !== defaultVal)
				if (userVal.toString().includes("${"))
					templates += `\t${key}: ` + `\`${userVal}\`,\n`;
				else templates += `\t${key}: ` + `"${userVal}",\n`;
			else if (
				["array", "object", "interger", "boolean"].includes(valueType)
			)
				if (defaultVal.toString().includes("${"))
					templates += `\t${key}: ` + `\`${defaultVal}\`,\n`;
				else templates += `\t${key}: ` + `${defaultVal},\n`;
			else if (defaultVal.toString().includes("${"))
				templates += `\t${key}: ` + `\`${defaultVal}\`,\n`;
			else templates += `\t${key}: ` + `"${defaultVal}",\n`;
		});

		templates += "}\n\n";

		templates += iotoNoteTemplate + "\n\n";

		templates += `const ${usedFor}sNoteSettings = {\n`;

		const noteOptions = TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Note" && o.for === usage,
		);

		noteOptions.forEach((opt) => {
			const userVal = noteSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			if (userVal && userVal !== defaultVal)
				if (userVal.toString().includes("${"))
					templates += `\t${key}: ` + `\`${userVal}\`,\n`;
				else templates += `\t${key}: ` + `"${userVal}",\n`;
			else if (
				["array", "object", "interger", "boolean"].includes(valueType)
			)
				if (defaultVal.toString().includes("${"))
					templates += `\t${key}: ` + `\`${defaultVal}\`,\n`;
				else templates += `\t${key}: ` + `${defaultVal},\n`;
			else if (defaultVal.toString().includes("${"))
				templates += `\t${key}: ` + `\`${defaultVal}\`,\n`;
			else templates += `\t${key}: ` + `"${defaultVal}",\n`;
		});

		templates += "}\n\n";
		switch (usage) {
			case "Task":
				const taskAction = `await tp.user.IOTOCreateTasksList(tp, await tp.user.IOTOGetFolderOption(tp, ${usedFor}sFolderSettings), ${usedFor}sNoteSettings);`;

				templates += taskAction + "\n\n";
				break;
			case "Custom":
				const noteAction = ``;

				templates += noteAction + "\n\n";
				break;
			default:
				const newNoteLink = `const newNoteLink = await tp.user.IOTOCreateOrOpenNote(tp, tR, await tp.user.IOTOGetFolderOption(tp, ${usedFor}sFolderSettings), ${usedFor}sNoteSettings);`;

				templates += newNoteLink + "\n\n";

				const tdl = `
if(addLinkToCurrentTDL) {
	const addLinkToTDLSettings = {
		taskFolder: taskFolder,
		targetHeading: LTDList${usage}SectionHeading,
		headingLevel: defaultTDLHeadingLevel,
		tdlDateFormat: defaultTDLDateFormat,
		followUpAction: parseInt(new${usage}NoteAddedToTDLFollowUpAction)
	}
	tR += await tp.user.IOTOAddLinkToTDL(tp, newNoteLink, addLinkToTDLSettings);
} else {
	tR += newNoteLink;
}`;
				templates += tdl + "\n\n";
		}

		return "<%*\n" + templates + "\n_%>";
	}
}
