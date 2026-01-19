import { Usage, TemplateType } from "./types/types";
import {
	TEMPLATE_OPTIONS,
	IOTO_VARIABLES,
	IOTO_NOTE_TEMPLATES,
	IOTO_ML,
} from "./models/constants";
import { Notice } from "obsidian";

export class ScriptEngine {
	static parseSelector(content: string): {
		usage: Usage | null;
		type: TemplateType | null;
		folderSettings: Record<string, any>;
		noteSettings: Record<string, any>;
	} {
		let usage: Usage | null = null;
		let type: TemplateType | null = null;

		const typeMatch = content.match(/\*\* type: (\w+)\n/);
		if (typeMatch) {
			type = this.convertFirstLetterToUpperCase(
				typeMatch[1] || "",
			) as TemplateType;
		}

		const usageMatch = content.match(/\*\* for: (\w+)\n/);
		if (usageMatch) {
			usage = this.convertFirstLetterToUpperCase(
				usageMatch[1] || "",
			) as Usage;
		}

		if (!type || !usage) {
			return {
				usage: null,
				type: null,
				folderSettings: {},
				noteSettings: {},
			};
		}

		const folderSettings = this.parseSettingsObject(
			content,
			"folderSettings",
		);
		const noteSettings = this.parseSettingsObject(content, "noteSettings");

		return {
			usage,
			type,
			folderSettings,
			noteSettings,
		};
	}

	static generateSelector(
		usage: Usage,
		folderSettings: Record<string, any>,
		noteSettings: Record<string, any>,
	): string {
		let templates = "";
		const usedFor = usage?.toLowerCase();

		console.dir(folderSettings);

		const templateFrontmatter = `/*\n** type: selector\n** for: ${usedFor}\n*/`;

		templates += templateFrontmatter + "\n\n";

		const iotoVariables = usedFor
			? IOTO_VARIABLES[usedFor as keyof typeof IOTO_VARIABLES]
			: "";

		const iotoNoteTemplate = usedFor
			? IOTO_NOTE_TEMPLATES[usedFor as keyof typeof IOTO_NOTE_TEMPLATES]
			: "";

		templates += iotoVariables + "\n\n";

		templates += IOTO_ML + "\n\n";

		templates += `const folderSettings = {\n`;

		const folderOptions = TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Folder" && o.for === usage,
		);

		folderOptions.forEach((opt) => {
			const userVal = folderSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			const val =
				userVal !== undefined && userVal !== defaultVal
					? userVal
					: defaultVal;
			const isTpl = val?.toString().includes("${");
			const isInt = valueType === "integer";
			if (["string", "file", "path"].includes(valueType)) {
				templates +=
					`\t${key}: ` + (isTpl ? `\`${val}\`` : `"${val}"`) + ",\n";
			} else {
				templates +=
					`\t${key}: ` +
					(isInt
						? `parseInt(${val})`
						: isTpl
							? val.toString().replace(/[$\{\}]/g, "")
							: JSON.stringify(val)) +
					",\n";
			}
		});

		templates += "}\n\n";

		templates += iotoNoteTemplate + "\n\n";

		templates += `const noteSettings = {\n`;

		const noteOptions = TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Note" && o.for === usage,
		);

		noteOptions.forEach((opt) => {
			const userVal = noteSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			const val =
				userVal !== undefined && userVal !== defaultVal
					? userVal
					: defaultVal;
			const isTpl = val?.toString().includes("${");
			const isInt = valueType === "integer";
			if (["string", "file", "path"].includes(valueType)) {
				templates +=
					`\t${key}: ` + (isTpl ? `\`${val}\`` : `"${val}"`) + ",\n";
			} else {
				templates +=
					`\t${key}: ` +
					(isInt
						? `${val}`
						: isTpl
							? val.toString().replace(/[$\{\}]/g, "")
							: JSON.stringify(val)) +
					",\n";
			}
		});

		templates += "}\n\n";

		const folderPath = `
let folderPath = "";

if(folderSettings.showSubFolders) {
	folderPath = await tp.user.IOTOGetFolderOption(tp, folderSettings);
} else {
	folderPath = folderSettings.folderPath;
}`;

		templates += folderPath + "\n\n";

		let finalAction = "";

		switch (usage) {
			case "Task":
				finalAction = `await tp.user.IOTOCreateTasksList(tp, folderPath, noteSettings);\n\n`;

				break;
			case "Custom":
				finalAction = `const newNoteLink = await tp.user.IOTOCreateOrOpenNote(tp, tR, folderPath, noteSettings);\n\n`;

				finalAction += `tR += newNoteLink;` + "\n\n";

				break;
			default:
				finalAction = `const newNoteLink = await tp.user.IOTOCreateOrOpenNote(tp, tR, folderPath, noteSettings);\n\n`;

				const tdl = `
if(noteSettings.addLinkToTDL) {
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
				finalAction += tdl + "\n\n";

				break;
		}

		templates += finalAction;

		return "<%*\n" + templates + "_%>";
	}

	private static convertFirstLetterToUpperCase(str: string) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	private static parseSettingsObject(
		content: string,
		varName: string,
	): Record<string, any> {
		let settings: Record<string, any> = {};
		const regex = new RegExp(`const\\s+${varName}\\s*=\\s*\\{`, "m");
		const match = content.match(regex);
		if (!match || match.index === undefined) return settings;
		const startObj = match.index + match[0].length - 1;
		const endObj = this.findMatchingBracket(content, startObj);
		if (endObj === -1) return settings;
		const raw = content.substring(startObj, endObj + 1);
		const sanitized = raw.replace(/`([\s\S]*?)`/g, (_, p1) => {
			const escaped = p1.replace(/"/g, '\\"').replace(/\n/g, "\\n");
			return `"${escaped}"`;
		});
		try {
			const obj = new Function("return " + sanitized)();
			if (obj && typeof obj === "object") {
				settings = obj as Record<string, any>;
			}
		} catch {}
		return settings;
	}

	private static findMatchingBracket(text: string, start: number): number {
		let count = 0;
		const open = text[start];
		const close = open === "[" ? "]" : "}";

		for (let i = start; i < text.length; i++) {
			if (text[i] === open) count++;
			else if (text[i] === close) count--;

			if (count === 0) return i;
		}
		return -1;
	}
}
