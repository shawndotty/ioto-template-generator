import { Usage, TemplateType } from "../types/types";
import {
	TEMPLATE_OPTIONS,
	IOTO_VARIABLES,
	IOTO_NOTE_TEMPLATES,
	IOTO_ML,
} from "../models/constants";

import { SWITCHERS_TEMPLATE_OPTIONS } from "../models/constantsSwitcher";
import { Notice } from "obsidian";
import { t } from "../lang/helpers";

export class ScriptEngine {
	static parseSelector(content: string): {
		usage: Usage | null;
		type: TemplateType | null;
		folderSettings: Record<string, any>;
		noteSettings: Record<string, any>;
	} {
		let usage: Usage | null = null;
		let type: TemplateType | null = null;

		const typeMatch = content.match(/\*\* type: (\w+)\r?\n/);
		if (typeMatch) {
			type = this.convertFirstLetterToUpperCase(
				typeMatch[1] || "",
			) as TemplateType;
		}

		const usageMatch = content.match(/\*\* for: (\w+)\r?\n/);
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

	static parseSwitcher(content: string): {
		usage: Usage | null;
		type: TemplateType | null;
		folderSettings: Record<string, any>;
	} {
		let usage: Usage | null = null;
		let type: TemplateType | null = null;

		const typeMatch = content.match(/\*\* type: (\w+)\r?\n/);
		if (typeMatch) {
			type = this.convertFirstLetterToUpperCase(
				typeMatch[1] || "",
			) as TemplateType;
		}

		const usageMatch = content.match(/\*\* for: (\w+)\r?\n/);
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
			};
		}

		const sharedFrontMatters = this.parseSettingsObject(
			content,
			"frontMatter",
		);

		// 如果 sharedFrontMatters 中存在 Project 属性，把它删掉
		if (
			sharedFrontMatters &&
			typeof sharedFrontMatters === "object" &&
			"Project" in sharedFrontMatters
		) {
			delete sharedFrontMatters.Project;
		}

		const switchers = this.parseSettingsArray(content, "switchers");

		const pathModeMatch = content.match(
			/const\s+pathMode\s*=\s*(true|false);/,
		);
		const useFullPath = pathModeMatch ? pathModeMatch[1] === "true" : false;
		const defaultTemplate = content.match(
			/tp.file.include\(`\[\[([^$\{]+)\]\]`\)/,
		);
		const defaultTemplateName = defaultTemplate ? defaultTemplate[1] : "";

		return {
			usage,
			type,
			folderSettings: {
				sharedFrontMatters,
				switchers,
				useFullPath,
				defaultTemplateName,
			},
		};
	}

	static generateSelector(
		usage: Usage,
		folderSettings: Record<string, any>,
		noteSettings: Record<string, any>,
	): string {
		let templates = "";
		const usedFor = usage?.toLowerCase();

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
						? `parseInt(${JSON.stringify(val)})`
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
						? `parseInt(${JSON.stringify(val)})`
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

				finalAction += `tR += newNoteLink.tR;` + "\n\n";

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
		followUpAction: parseInt(noteSettings.addLinkToTDLFollowUpAction)
	}
	tR += await tp.user.IOTOAddLinkToTDL(tp, newNoteLink, addLinkToTDLSettings);
} else {
	tR += newNoteLink.tR;
}`;
				finalAction += tdl + "\n\n";

				break;
		}

		templates += finalAction;

		return "<%*\n" + templates + "_%>";
	}

	static generateSwitcher(
		usage: Usage,
		folderSettings: Record<string, any>,
	): string {
		let templates = "";
		const usedFor = usage?.toLowerCase();

		const templateFrontmatter = `/*\n** type: switcher\n** for: ${usedFor}\n*/`;
		templates += templateFrontmatter + "\n\n";

		let header = "";

		switch (usedFor) {
			case "input":
			case "output":
				header = `
const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = activeFileFrontmatter?.Project;
const subjectName = activeFileFrontmatter?.Subject;`;
				break;
			case "outcome":
				header = `
const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const {projectNameFormat} = app.plugins.plugins["ioto-settings"].settings;
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = activeFileFrontmatter?.Project || await tp.user.IOTOCreateProjectName(tp.file.folder(true), projectNameFormat);
const subjectName = activeFileFrontmatter?.Subject;`;
				break;
			case "task":
				header = `
const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const {LTDListInputSectionHeading, LTDListOutputSectionHeading, LTDListOutcomeSectionHeading, defaultTDLDateFormat, projectNameFormat, defaultTDLHeadingLevel} = app.plugins.plugins["ioto-settings"].settings;
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const projectName = await tp.user.IOTOCreateProjectName(tp.file.folder(true), projectNameFormat);`;
				break;
			case "custom":
				header = `
const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const {projectNameFormat} = app.plugins.plugins["ioto-settings"].settings;
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = activeFileFrontmatter?.Project || await tp.user.IOTOCreateProjectName(tp.file.folder(true), projectNameFormat);
const subjectName = activeFileFrontmatter?.Subject;`;
				break;
			default:
				break;
		}

		templates += header + "\n\n";

		const folderOptions = SWITCHERS_TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Folder" && o.for === usage,
		);

		let prefixStr = "";
		let frontmatterStr = "";
		let switchersStr = "";
		let defaultTemplate = "";
		let defaultInclude = "";

		folderOptions.forEach((opt) => {
			const userVal = folderSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			const val =
				userVal !== undefined && userVal !== defaultVal
					? userVal
					: defaultVal;

			switch (key) {
				case "useFullPath":
					prefixStr += `const pathMode = ${val}; \nconst prefix = pathMode ? folder : folder.split("/").last();`;
					break;
				case "sharedFrontMatters":
					frontmatterStr += `const frontMatter = {\n`;
					frontmatterStr += '\tProject: \`["${projectName}"]\`,\n';
					const targetFrontmatter = {};
					if ("outcome" === usedFor) {
						Object.assign(
							targetFrontmatter,
							{ Status: t("ONGOING") },
							val,
						);
					} else if (usedFor === "task") {
						Object.assign(
							targetFrontmatter,
							{ cssclasses: ["hideProperties", "iotoTDL"] },
							val,
						);
					} else {
						Object.assign(targetFrontmatter, val);
					}
					Object.entries(targetFrontmatter).forEach(([key, val]) => {
						// 根据类型决定是否需要引号
						if (typeof val === "string") {
							frontmatterStr += `\t${key}: "${val}",\n`;
						} else if (
							typeof val === "boolean" ||
							typeof val === "number"
						) {
							frontmatterStr += `\t${key}: ${val},\n`;
						} else if (Array.isArray(val)) {
							frontmatterStr += `\t${key}: ${JSON.stringify(val)},\n`;
						} else {
							// 其他类型（如对象）也使用 JSON 字符串化
							frontmatterStr += `\t${key}: ${JSON.stringify(val)},\n`;
						}
					});

					frontmatterStr += "};";
					break;
				case "switchers":
					let switchersJson = JSON.stringify(val, null, "\t");
					switchersJson = switchersJson.replace(
						/"(template|match)":\s*"((?:[^"\\]|\\.)*)"/g,
						(_, key, val) => {
							const content = val
								.replace(/\\"/g, '"')
								.replace(/`/g, "\\`");
							return `"${key}": \`${content}\``;
						},
					);
					switchersStr += `const switchers = ${switchersJson};\n`;
					break;

				case "defaultTemplate":
					defaultTemplate = val;
					defaultInclude = defaultTemplate
						? `(await tp.file.include(\`[[${defaultTemplate}]]\`))`
						: `defaultNoteTemplate`;
					break;

				default:
					break;
			}
		});

		templates += prefixStr + "\n\n";

		templates += frontmatterStr + "\n\n";

		templates += switchersStr + "\n\n";

		const footer1 = `
const matched = switchers.find(item => prefix.includes(item.match));
let includedNote = "";
let defaultNoteTemplate = "";
if(tp.file.find_tfile(ml.t("IOTODefault${usage}NoteTemplate"))){
	defaultNoteTemplate = await tp.user.IOTOLoadTemplate(tp, tR, this.app, ml.t("IOTODefault${usage}NoteTemplate"))
}`;

		templates += footer1 + "\n\n";

		let footer2 = "";

		switch (usedFor) {
			case "task":
				footer2 = `if (matched && !tp.file.title.includes(ml.t("Subject"))) {
	const matchedTemplate = tp.file.find_tfile(matched.template);
	includedNote = matchedTemplate ? (await tp.file.include(\`[[\$\{matched.template\}]]\`)) : defaultNoteTemplate; 
} else if(tp.file.title.includes(ml.t("Subject"))) {
	frontMatter.Subject = tp.file.title.split("-").last();
	includedNote = "";
} else {
	includedNote = ${defaultInclude};
}

tR += util.noteFrontMatterCooker(frontMatter, includedNote);`;
				break;

			default:
				footer2 = `if (subjectName) {
    frontMatter.Subject = \`["\$\{subjectName\}"]\`;
}
if (matched) {
	const matchedTemplate = tp.file.find_tfile(matched.template);
	includedNote = matchedTemplate ? (await tp.file.include(\`[[\$\{matched.template\}]]\`)) : defaultNoteTemplate; 
} else {
	includedNote = ${defaultInclude};
}

tR += util.noteFrontMatterCooker(util.addIOOLinkPropertyToFrontMatter(frontMatter, tp.config.active_file), includedNote);`;
				break;
		}

		templates += footer2 + "\n\n";

		let finalTemplate = "<%*\n" + templates + "\n_%>";

		const taskAppended = `\n
<%*\nif (tp.file.title.toLowerCase().includes(ml.t("Untitle"))) {
	await tp.file.rename(projectName + "-" + tp.date.now(defaultTDLDateFormat));
}\n_%>`;

		if (usedFor === "task") {
			finalTemplate += taskAppended;
		}

		return finalTemplate;
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

	private static parseSettingsArray(
		content: string,
		varName: string,
	): Record<string, any> {
		let settings: Record<string, any> = {};
		const regex = new RegExp(`const\\s+${varName}\\s*=\\s*\\[`, "m");
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
