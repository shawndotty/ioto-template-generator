import { Usage, TemplateType } from "../types/types";
import {
	TEMPLATE_OPTIONS,
	IOTO_VARIABLES,
	IOTO_NOTE_TEMPLATES,
	IOTO_ML,
} from "../models/constants";

import { SWITCHERS_TEMPLATE_OPTIONS } from "../models/constantsSwitcher";

export type ParseFailureCode =
	| "missing-identifier"
	| "eval-error"
	| "unbalanced"
	| "missing-folder-settings";

export interface ParseFailure {
	code: ParseFailureCode;
	detail?: string;
}

export interface SelectorParseResult {
	usage: Usage | null;
	type: TemplateType | null;
	folderSettings: Record<string, any> | null;
	noteSettings: Record<string, any> | null;
	failure: ParseFailure | null;
}

interface BlockResult {
	found: boolean;
	value: Record<string, any> | null;
	raw: string | null;
	failure: ParseFailure | null;
}

class MissingIdentifierError extends Error {
	readonly identifier: string;

	constructor(identifier: string) {
		super(`Missing identifier: ${identifier}`);
		this.name = "MissingIdentifierError";
		this.identifier = identifier;
	}
}

export class ScriptEngine {
	static parseSelector(
		content: string,
		stubs: Record<string, unknown> = {},
	): SelectorParseResult {
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
				folderSettings: null,
				noteSettings: null,
				failure: null,
			};
		}

		// Any failure yields no partial configuration: the caller can only apply
		// the whole result or leave the form untouched.
		const folderResult = this.parseSettingsObject(
			content,
			"folderSettings",
			stubs,
			true,
		);
		if (!folderResult.found) {
			return this.failed({ code: "missing-folder-settings" });
		}
		if (folderResult.failure || !folderResult.value) {
			return this.failed(folderResult.failure);
		}

		// Not every selector carries note settings.
		const noteResult = this.parseSettingsObject(
			content,
			"noteSettings",
			stubs,
			true,
		);
		const noteSettings = noteResult.found ? noteResult.value : {};
		if (noteResult.failure || !noteSettings) {
			return this.failed(noteResult.failure);
		}

		this.restoreSourceExpressions(
			folderResult.value,
			folderResult.raw ?? "",
			usage,
			"Folder",
		);
		if (noteResult.raw) {
			this.restoreSourceExpressions(
				noteSettings,
				noteResult.raw,
				usage,
				"Note",
			);
		}

		const switcherTemplateLiteral =
			this.detectSwitcherTemplateLiteral(content);
		if (switcherTemplateLiteral !== null) {
			noteSettings.template = switcherTemplateLiteral;
		}

		return {
			usage,
			type,
			folderSettings: folderResult.value,
			noteSettings,
			failure: null,
		};
	}

	private static failed(failure: ParseFailure | null): SelectorParseResult {
		return {
			usage: null,
			type: null,
			folderSettings: null,
			noteSettings: null,
			failure: failure ?? { code: "eval-error" },
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

		// Lenient on purpose: this task only changes the selector evaluation.
		const frontMatterResult = this.parseSettingsObject(
			content,
			"frontMatter",
			{},
			false,
		);
		const sharedFrontMatters = frontMatterResult.value ?? {};

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
		const defaultTemplate =
			content.match(/tp\.file\.include\(`\[\[([^$\{]+)\]\]`\)/) ||
			content.match(
				/IOTOLoadTemplate\.load\(\s*tp\s*,\s*app\s*,\s*"([^"]+)"\s*\)/,
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
				// 与 SWITCHERS_TEMPLATE_OPTIONS 的字段名对齐，导入后才能真正回填/回写默认模板
				defaultTemplate: defaultTemplateName,
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

		if ("Task" === usage) {
			templates += `const selectedText = ((tp.file.selection && tp.file.selection()) || "").trim();
const activeFileBaseName = tp.config?.active_file?.basename ?? "";
const currentFolderPath = tp.file?.folder?.(true) ?? "";
const isInTaskFolder = currentFolderPath ? currentFolderPath.startsWith(taskFolder) : false;
const onlyUseDateType = !(taskSelectorEnableSubjectTask || taskSelectorEnablePlanTask || taskSelectorEnableNormalTask);\n`;
		}

		templates += `const folderSettings = {\n`;

		const folderOptions = TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Folder" && o.for === usage,
		);

		folderOptions.forEach((opt) => {
			const userVal = folderSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			const isDefault =
				userVal === undefined ||
				JSON.stringify(userVal) === JSON.stringify(defaultVal);
			if (isDefault && opt.defaultExpression) {
				templates += `\t${key}: ${opt.defaultExpression},\n`;
				return;
			}
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

		if ("Task" === usage) {
			templates += `\tcreatePlanMode: false,\n`;
			templates += `\ttaskType: "date",\n`;
			templates += `\tupTask: null,\n`;
			templates += `\topenAfterCreate: true,\n`;
			templates += `\tselectedText,\n`;
		}

		const noteOptions = TEMPLATE_OPTIONS.filter(
			(o) => o.level === "Note" && o.for === usage,
		);

		noteOptions.forEach((opt) => {
			const userVal = noteSettings[opt.name];
			const defaultVal = opt.defaultValue;
			const valueType = opt.valueType;
			const key = opt.name;
			const isDefault =
				userVal === undefined ||
				JSON.stringify(userVal) === JSON.stringify(defaultVal);
			if (isDefault && opt.defaultExpression) {
				templates += `\t${key}: ${opt.defaultExpression},\n`;
				return;
			}
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

		const taskFolderPath = `
let folderPath = "";
let scope = "otherProject";

if (isInTaskFolder) {
    const baseChoices = [ml.t("CreateTaskForCurrentProject"), ml.t("CreateTaskForOtherProject")];
    const baseValues = ["currentProject", "otherProject"];
    const scopeChoices = onlyUseDateType 
        ? baseChoices 
        : [ml.t("CreateSubTaskForCurrent"), ...baseChoices];
    const scopeValues = onlyUseDateType 
        ? baseValues 
        : ["subTask", ...baseValues];
    const labeledChoices = scopeChoices.map((choice, index) => \`\${index + 1}. \${choice}\`);
    const selectedScope = await tp.system.suggester(labeledChoices, scopeValues);

    if (!selectedScope) {
        if (selectedText) {
            tR += selectedText;
        }
        return tR;
    } else {
        scope = selectedScope;
    }

}

if (scope === "subTask") {
    noteSettings.upTask = activeFileBaseName ? \`[[\${activeFileBaseName}]]\` : null;
    folderPath = currentFolderPath;

    let subTaskOpenMode = taskSubTaskOpenMode || "open";
    if (subTaskOpenMode === "ask") {
        const pickedMode = await tp.system.suggester(
            [ml.t("SubTaskFollowUpLinkOnly"), ml.t("SubTaskFollowUpOpen")],
            ["linkOnly", "open"],
        );
        subTaskOpenMode = pickedMode || "linkOnly";
    }
    noteSettings.openAfterCreate = subTaskOpenMode === "open";
} else if (scope === "currentProject") {
    folderPath = currentFolderPath;
} else {
    if (scope === "otherProject" && isInTaskFolder) {
        folderSettings.excludesPaths = [
        ...folderSettings.excludesPaths,
        currentFolderPath,
        ];
    }
    if (folderSettings.showSubFolders) {
            folderPath = await tp.user.IOTOGetFolderOption(tp, folderSettings);
    } else {
            folderPath = folderSettings.folderPath;
    }

}

if (!folderPath || !scope) {
    if (selectedText) {
        tR += selectedText;
    }
    return tR;
}

const taskTypeChoices = [ml.t("CreateDateTask")];
const taskTypeValues = ["date"];

if (Boolean(taskSelectorEnableSubjectTask)) {
    taskTypeChoices.push(ml.t("CreateSubjectTask"));
    taskTypeValues.push("subject");
}

if (Boolean(taskSelectorEnablePlanTask)) {
    taskTypeChoices.push(ml.t("CreatePlanTask"));
    taskTypeValues.push("plan");
}

if (Boolean(taskSelectorEnableNormalTask)) {
    taskTypeChoices.push(ml.t("CreateNormalTask"));
    taskTypeValues.push("normal");
}

let selectedTaskType = "";
if (taskTypeValues.length === 1) {
    selectedTaskType = taskTypeValues[0];
} else {
    const labledTaskTypeChoices = taskTypeChoices.map((choice, index) => \`\${index + 1}. \${choice}\`);
    selectedTaskType = await tp.system.suggester(labledTaskTypeChoices, taskTypeValues);
}

if (!selectedTaskType) {
    if (selectedText) {
    tR += selectedText;
    }
    return tR;
} else {
    noteSettings.taskType = selectedTaskType;
}`;

		if ("Task" === usage) {
			templates += taskFolderPath + "\n\n";
		} else {
			templates += folderPath + "\n\n";
		}

		let finalAction = "";

		switch (usage) {
			case "Task":
				finalAction = `tR += await tp.user.IOTOCreateTasksList(tp, folderPath, noteSettings) || "";\n\n`;

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
const subjectName = activeFileFrontmatter?.Subject;
const planName = activeFileFrontmatter?.Plan;`;
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
const subjectName = activeFileFrontmatter?.Subject;
const planName = activeFileFrontmatter?.Plan;`;
				break;
			case "task":
				header = `
const ml = new (tp.user.IOTOMultiLangs(tp))(tp);
const {LTDListInputSectionHeading, LTDListOutputSectionHeading, LTDListOutcomeSectionHeading, defaultTDLDateFormat, projectNameFormat, defaultTDLHeadingLevel} = app.plugins.plugins["ioto-settings"].settings;
const utilClass = tp.user.IOTOUtility(tp, app);
const util = new utilClass(tp, app);
const folder = tp.file.folder(true);
const activeFileFrontmatter = app.metadataCache.getFileCache(tp.config.active_file)?.frontmatter;
const projectName = await tp.user.IOTOCreateProjectName(tp.file.folder(true), projectNameFormat);
const subjectName = activeFileFrontmatter?.Subject;
const planName = activeFileFrontmatter?.Plan;`;
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
const subjectName = activeFileFrontmatter?.Subject;
const planName = activeFileFrontmatter?.Plan;`;
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
		let defaultLoadExpr = "";

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
					const targetFrontmatter: Record<string, any> = {};
					if (usedFor === "task") {
						Object.assign(
							targetFrontmatter,
							{ cssclasses: `["hideProperties", "iotoTDL"]` },
							val,
						);
					} else {
						Object.assign(targetFrontmatter, val);
					}
					Object.entries(targetFrontmatter).forEach(([key, val]) => {
						// 根据类型决定是否需要引号
						if (typeof val === "string") {
							frontmatterStr += `\t${key}: ${this.quoteJsString(val)},\n`;
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
					defaultLoadExpr =
						!userVal || userVal === defaultVal
							? `ml.t("IOTODefault${usage}NoteTemplate")`
							: this.quoteJsString(String(val));
					break;

				default:
					break;
			}
		});

		templates += prefixStr + "\n\n";

		templates += frontmatterStr + "\n\n";

		if ("task" === usedFor) {
			templates += `const taskMetaStore = app.plugins.plugins["ioto-settings"].__iotoTaskMeta;
const taskMetaKey = tp.file.path(true);
const pendingMeta = (taskMetaStore && taskMetaStore[taskMetaKey]) || null;
if (pendingMeta && pendingMeta.upTask) {
	frontMatter.UpTask = pendingMeta.upTask;
}
if (taskMetaStore) delete taskMetaStore[taskMetaKey];\n\n`;
		} else {
			templates += `if (subjectName) {
	frontMatter.Subject = \`["\$\{subjectName\}"]\`;
}

if (planName) {
	frontMatter.Plan = \`["\${planName}"]\`;
}\n\n`;
		}

		templates += switchersStr + "\n\n";

		const footer = `
const matched = switchers.find(item => prefix.includes(item.match));
let usedTemplate = null;

if (matched) {
	usedTemplate = await tp.user.IOTOLoadTemplate.load(tp, app, matched.template);
	if (!usedTemplate.file) {
		new tp.obsidian.Notice(ml.t("TemplateNotExist", { template: matched.template }));
	}
}

if (!usedTemplate || !usedTemplate.file) {
	usedTemplate = await tp.user.IOTOLoadTemplate.load(tp, app, ${defaultLoadExpr});
}

const includedNote = usedTemplate.content;
const templateLink = tp.user.IOTOLoadTemplate.linkValue(app, usedTemplate.file);
if (templateLink) frontMatter.iotoTemplate = templateLink;

tR += util.noteFrontMatterCooker(util.addIOOLinkPropertyToFrontMatter(frontMatter, tp.config.active_file), includedNote);`;

		const taskFooter = `
const matched = switchers.find(item => prefix.includes(item.match));

const templates = {
	note: "IOTODefaultTaskNoteTemplate",
	subject: "IOTODefaultSubjectNoteTemplate",
	plan: "IOTODefaultPlanNoteTemplate",
	normal: "IOTODefaultNormalNoteTemplate",
};

// 四个模板并行加载；每一项都自带 file，属性不会退化成「最后一次 include 的那个」
const [noteTpl, subjectTpl, planTpl, normalTpl] = await Promise.all(
	Object.values(templates).map(key => tp.user.IOTOLoadTemplate.load(tp, app, ml.t(key)))
);

let usedTemplate = null;
if (matched) {
	const matchedTpl = await tp.user.IOTOLoadTemplate.load(tp, app, matched.template);
	usedTemplate = matchedTpl.file ? matchedTpl : noteTpl;
} else if (tp.file.title.includes(\`-\${ml.t("Subject")}-\`)) {
	frontMatter.Subject = [\`"\${tp.file.title.split("-").last()}"\`];
	usedTemplate = subjectTpl;
} else if (tp.file.title.includes(\`-\${ml.t("Plan")}-\`)) {
	frontMatter.Plan = [\`"\${tp.file.title.split("-").last()}"\`];
	if (subjectName) {
		frontMatter.Subject = \`["\${subjectName}"]\`;
	}
	usedTemplate = planTpl;
} else if (!tp.file.title.startsWith(\`\${projectName}-\`)) {
	if (subjectName) {
		frontMatter.Subject = \`["\${subjectName}"]\`
	}
	if (planName) {
		frontMatter.Plan = \`["\${planName}"]\`;
	}
	usedTemplate = normalTpl;
} else {
	usedTemplate = noteTpl;
}

const includedNote = usedTemplate.content;
const templateLink = tp.user.IOTOLoadTemplate.linkValue(app, usedTemplate.file);
if (templateLink) frontMatter.iotoTemplate = templateLink;

tR += util.noteFrontMatterCooker(frontMatter, includedNote);`;

		templates += ("task" === usedFor ? taskFooter : footer) + "\n\n";

		return "<%*\n" + templates + "\n_%>";
	}

	private static quoteJsString(value: string): string {
		if (!value.includes("'") && value.includes('"')) {
			return `'${value}'`;
		}
		return JSON.stringify(value);
	}

	private static convertFirstLetterToUpperCase(str: string) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	private static parseSettingsObject(
		content: string,
		varName: string,
		stubs: Record<string, unknown>,
		strict: boolean,
	): BlockResult {
		const regex = new RegExp(`const\\s+${varName}\\s*=\\s*\\{`, "m");
		const match = content.match(regex);
		if (!match || match.index === undefined) {
			return { found: false, value: null, raw: null, failure: null };
		}
		const startObj = match.index + match[0].length - 1;
		const endObj = this.findMatchingBracket(content, startObj);
		if (endObj === -1) {
			return {
				found: true,
				value: null,
				raw: null,
				failure: { code: "unbalanced" },
			};
		}
		const raw = content.substring(startObj, endObj + 1);
		// Template literals are flattened before evaluation so that `${...}`
		// survives as literal text (the form stores templates, not values).
		const sanitized = this.flattenTemplateLiterals(raw);
		try {
			// The body must stay in sloppy mode: `with` is a SyntaxError in strict
			// mode. Adding "use strict" here would make every import fail; the
			// missing-identifier unit test guards that.
			const fn = new Function(
				"__scope",
				`with(__scope){ return ${sanitized}; }`,
			);
			const obj = fn(this.createStubScope(stubs, strict));
			if (obj && typeof obj === "object") {
				return {
					found: true,
					value: obj as Record<string, any>,
					raw,
					failure: null,
				};
			}
			return {
				found: true,
				value: null,
				raw,
				failure: { code: "eval-error", detail: "not an object" },
			};
		} catch (error) {
			if (error instanceof MissingIdentifierError) {
				return {
					found: true,
					value: null,
					raw,
					failure: {
						code: "missing-identifier",
						detail: error.identifier,
					},
				};
			}
			return {
				found: true,
				value: null,
				raw,
				failure: {
					code: "eval-error",
					detail: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private static flattenTemplateLiterals(raw: string): string {
		return raw.replace(/`([\s\S]*?)`/g, (_, p1: string) => {
			const escaped = p1.replace(/"/g, '\\"').replace(/\n/g, "\\n");
			return `"${escaped}"`;
		});
	}

	private static createStubScope(
		stubs: Record<string, unknown>,
		strict: boolean,
	): Record<string, unknown> {
		return new Proxy(stubs, {
			// Every identifier resolves through the scope so that a branch like
			// `inputSelectorExcludesPaths ? ... : []` sees the real stub value.
			has: () => true,
			get: (target, key) => {
				// `with` reads Symbol.unscopables; never throw for symbols.
				if (typeof key === "symbol") return undefined;
				if (key in target) return target[key];
				if (key in globalThis) {
					return (globalThis as Record<string, unknown>)[key];
				}
				if (strict) throw new MissingIdentifierError(key);
				return undefined;
			},
		});
	}

	/**
	 * Turns non-literal string fields back into `${原始表达式}`.
	 *
	 * `generateSelector` wraps any value containing "${" in backticks, and the
	 * form defaults are templates such as "${inputFolder}". Writing the resolved
	 * value instead would freeze the script to the current settings.
	 */
	private static restoreSourceExpressions(
		settings: Record<string, any>,
		rawObject: string,
		usage: Usage,
		level: "Folder" | "Note",
	): void {
		const entries = this.splitTopLevelEntries(rawObject);
		TEMPLATE_OPTIONS.filter(
			(option) =>
				option.type === "Selector" &&
				option.for === usage &&
				option.level === level,
		).forEach((option) => {
			if (!["string", "file", "path"].includes(option.valueType)) return;
			const entry = entries.find((item) => item.key === option.name);
			if (!entry || this.isPlainLiteral(entry.rawValue)) return;
			if (typeof settings[option.name] !== "string") return;
			settings[option.name] = `\${${entry.rawValue}}`;
		});
	}

	private static isPlainLiteral(value: string): boolean {
		const v = value.trim();
		return (
			/^"(?:\\.|[^"\\])*"$/.test(v) ||
			/^'(?:\\.|[^'\\])*'$/.test(v) ||
			/^`[\s\S]*`$/.test(v) ||
			/^-?\d+(?:\.\d+)?$/.test(v) ||
			/^(true|false|null|undefined)$/.test(v)
		);
	}

	private static detectSwitcherTemplateLiteral(content: string): string | null {
		const match = content.match(
			/const\s+switcherTemplate\s*=\s*"([^"]*)"\s*;/,
		);
		return match ? match[1] ?? "" : null;
	}

	/** Splits a flat object literal into `key` / raw value pairs. */
	private static splitTopLevelEntries(
		rawObject: string,
	): { key: string; rawValue: string }[] {
		const entries: { key: string; rawValue: string }[] = [];
		const start = rawObject.indexOf("{");
		const end = rawObject.lastIndexOf("}");
		if (start === -1 || end <= start) return entries;

		const pushEntry = (text: string) => {
			const entry = text.trim();
			if (!entry) return;
			const colon = this.findTopLevelColon(entry);
			if (colon === -1) return;
			const key = entry
				.slice(0, colon)
				.trim()
				.replace(/^["']|["']$/g, "");
			entries.push({ key, rawValue: entry.slice(colon + 1).trim() });
		};

		let depth = 0;
		let current = "";
		let quote: string | null = null;
		for (let i = start + 1; i < end; i++) {
			const ch = rawObject[i];
			if (quote) {
				current += ch;
				if (ch === "\\" && i + 1 < end) {
					current += rawObject[i + 1];
					i++;
				} else if (ch === quote) {
					quote = null;
				}
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch;
				current += ch;
				continue;
			}
			if (ch === "{" || ch === "[" || ch === "(") depth++;
			else if (ch === "}" || ch === "]" || ch === ")") depth--;
			if (ch === "," && depth === 0) {
				pushEntry(current);
				current = "";
				continue;
			}
			current += ch;
		}
		pushEntry(current);
		return entries;
	}

	private static findTopLevelColon(entry: string): number {
		let depth = 0;
		let quote: string | null = null;
		for (let i = 0; i < entry.length; i++) {
			const ch = entry[i];
			if (quote) {
				if (ch === "\\") i++;
				else if (ch === quote) quote = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "{" || ch === "[" || ch === "(") depth++;
			else if (ch === "}" || ch === "]" || ch === ")") depth--;
			else if (ch === ":" && depth === 0) return i;
		}
		return -1;
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
