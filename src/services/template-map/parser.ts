import type { Ml } from "./multilang";
import { findMatchingBrace } from "./multilang";

/**
 * 用「带桩作用域」求值选择器/切换器脚本里的配置对象。
 *
 * 与 `ScriptEngine.parseSelector` 的差别：那边的目标是把 `${...}` 还原成表达式
 * 以便重新生成脚本，这里要的是**求值后的值**（地图展示的是运行时真正用的东西）。
 * 求值失败必须显式报错，不许静默返回 `{}`。
 */

export interface SwitcherRuleParse {
	/** 数组里这条规则的源码原文 */
	raw: string;
	match: string | null;
	/** 模板字段的源码原文（模板字面量形态） */
	templateRaw: string | null;
	/** 已折算 ml.t 的模板名 */
	templateName: string | null;
	unresolved: string[];
}

export interface SwitcherParse {
	rules: SwitcherRuleParse[];
	pathMode: boolean;
	defaultTemplateName: string | null;
	error: string | null;
}

export interface FolderSettingsParse {
	value: Record<string, unknown> | null;
	error: string | null;
}

class MissingIdentifierError extends Error {
	constructor(identifier: string) {
		super(`Missing identifier: ${identifier}`);
		this.name = "MissingIdentifierError";
	}
}

function findBracedBlock(content: string, varName: string): string | null {
	const regex = new RegExp(`const\\s+${varName}\\s*=\\s*\\{`, "m");
	const match = regex.exec(content);
	if (!match || match.index === undefined) return null;
	const start = match.index + match[0].length - 1;
	const end = findMatchingBrace(content, start);
	return end === -1 ? null : content.slice(start, end + 1);
}

/** 从 `[` 位置找配对的 `]`：这里的数组元素是对象字面量，括号不会交叠。 */
function findArrayBlock(content: string, varName: string): string | null {
	const regex = new RegExp(`const\\s+${varName}\\s*=\\s*\\[`, "m");
	const match = regex.exec(content);
	if (!match || match.index === undefined) return null;
	const start = match.index + match[0].length - 1;

	let depth = 0;
	let quote: string | null = null;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = start; index < content.length; index++) {
		const char = content[index] ?? "";
		const next = content[index + 1] ?? "";

		if (inLineComment) {
			if (char === "\n") inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index++;
			}
			continue;
		}
		if (quote) {
			if (char === "\\") {
				index++;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === "/" && next === "/") {
			inLineComment = true;
			index++;
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			index++;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}

		if (char === "[") depth++;
		else if (char === "]") {
			depth--;
			if (depth === 0) return content.slice(start, index + 1);
		}
	}
	return null;
}

/** 按顶层逗号切分（忽略引号、模板串与嵌套括号里的逗号）。 */
export function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let current = "";
	let depth = 0;
	let quote: string | null = null;

	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? "";
		if (quote) {
			current += char;
			if (char === "\\") {
				current += text[index + 1] ?? "";
				index++;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			current += char;
			continue;
		}
		if (char === "{" || char === "[" || char === "(") depth++;
		else if (char === "}" || char === "]" || char === ")") depth--;

		if (char === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);

	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function rawField(entry: string, field: string): string | null {
	const regex = new RegExp(
		`["']?${field}["']?\\s*:\\s*(\`[\\s\\S]*?\`|"[^"]*"|'[^']*')`,
	);
	const match = regex.exec(entry);
	if (!match || !match[1]) return null;
	const value = match[1];
	if (value.length >= 2) return value.slice(1, -1);
	return value;
}

export function parseSwitcherRules(content: string, ml: Ml): SwitcherParse {
	const block = findArrayBlock(content, "switchers");
	if (!block) {
		return {
			rules: [],
			pathMode: false,
			defaultTemplateName: null,
			error: "switchers-not-found",
		};
	}

	const body = block.slice(1, -1);
	const entries = splitTopLevel(body).filter((entry) =>
		entry.trim().startsWith("{"),
	);

	const rules: SwitcherRuleParse[] = entries.map((entry) => {
		const templateRaw = rawField(entry, "template");
		try {
			// 规则是用户脚本里的对象字面量，需要真实求值才能拿到 ml.t 结果。
			// eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
			const value: unknown = new Function(
				"ml",
				`return (${entry});`,
			)(ml);
			if (!value || typeof value !== "object") {
				return {
					raw: entry,
					match: null,
					templateRaw,
					templateName: null,
					unresolved: [entry],
				};
			}
			const record = value as { match?: unknown; template?: unknown };
			const match =
				typeof record.match === "string" ? record.match : null;
			const template =
				typeof record.template === "string" ? record.template : null;
			return {
				raw: entry,
				match,
				templateRaw: templateRaw ?? template,
				templateName: template,
				unresolved: match === null || template === null ? [entry] : [],
			};
		} catch {
			return {
				raw: entry,
				match: null,
				templateRaw,
				templateName: null,
				unresolved: [entry],
			};
		}
	});

	const pathModeMatch = /const\s+pathMode\s*=\s*(true|false)\s*;/.exec(content);
	const pathMode = pathModeMatch ? pathModeMatch[1] === "true" : false;

	return {
		rules,
		pathMode,
		defaultTemplateName: detectDefaultTemplateName(content, ml),
		error: null,
	};
}

function detectDefaultTemplateName(content: string, ml: Ml): string | null {
	const keyMatch = /ml\.t\(\s*["'`](IOTODefault[A-Za-z0-9]*Template)["'`]\s*\)/.exec(
		content,
	);
	if (keyMatch && keyMatch[1]) {
		return ml.t(keyMatch[1]);
	}

	const literalMatch =
		/IOTOLoadTemplate\.load\(\s*tp\s*,\s*app\s*,\s*["']([^"']+)["']\s*\)/.exec(
			content,
		);
	return literalMatch && literalMatch[1] ? literalMatch[1] : null;
}

function createScope(values: Record<string, unknown>): Record<string, unknown> {
	return new Proxy(values, {
		has: () => true,
		get: (target, key) => {
			// `with` 会读 Symbol.unscopables，不能在这里抛错。
			if (typeof key === "symbol") return undefined;
			if (key in target) return target[key];
			if (key in globalThis) {
				return (globalThis as Record<string, unknown>)[key];
			}
			throw new MissingIdentifierError(key);
		},
	});
}

export function parseFolderSettings(
	content: string,
	scope: Record<string, unknown>,
): FolderSettingsParse {
	const block = findBracedBlock(content, "folderSettings");
	if (!block) return { value: null, error: "folder-settings-not-found" };

	try {
		// 函数体必须停在 sloppy mode：`with` 在严格模式下是 SyntaxError。
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const fn = new Function("__scope", `with(__scope){ return ${block}; }`);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		const value: unknown = fn(createScope(scope));
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return { value: null, error: "folder-settings-not-an-object" };
		}
		const record = value as Record<string, unknown>;
		if (record.folderPath === undefined) {
			return { value: null, error: "folder-path-unresolved" };
		}
		return { value: record, error: null };
	} catch (error) {
		const detail =
			error instanceof Error ? error.message : String(error);
		return { value: null, error: detail };
	}
}
