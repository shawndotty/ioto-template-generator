import type { Ml } from "./multilang";
import { findMatchingBrace } from "./multilang";
import type { SelectorHeader } from "./types";

/**
 * 用「带桩作用域」求值选择器/切换器脚本里的配置对象。
 *
 * 与 `ScriptEngine.parseSelector` 的差别：那边的目标是把 `${...}` 还原成表达式
 * 以便重新生成脚本，这里要的是**求值后的值**（地图展示的是运行时真正用的东西）。
 * 求值失败必须显式报错，不许静默返回 `{}`。
 */

/** 选择器头注释：`** type:` 定身份，`** for:` 定分类。 */
export function parseHeader(content: string): SelectorHeader {
	const typeMatch = /\*\*\s*type\s*:\s*(selector|switcher)\b/i.exec(content);
	const forMatch = /\*\*\s*for\s*:\s*([A-Za-z]+)/i.exec(content);
	const type = typeMatch?.[1]?.toLowerCase();
	return {
		type: type === "selector" || type === "switcher" ? type : null,
		for: forMatch?.[1] ? forMatch[1].toLowerCase() : null,
	};
}

/** `noteSettings.template` 的静态形态；解析不了就显式 unresolved，绝不 eval。 */
export type BindingParse =
	| {
			kind: "name";
			name: string;
			via: "literal" | "mlt" | "identifier-mlt" | "identifier-literal";
			/** `via` 为 mlt / identifier-mlt 时的字典键 */
			key: string | null;
	  }
	| { kind: "none" }
	| {
			kind: "unresolved";
			raw: string;
			reason:
				| "no-note-settings"
				| "no-template-field"
				| "dynamic-expression"
				| "unknown-identifier";
	  };

const ML_CALL = /^ml\.t\(\s*(["'`])([A-Za-z0-9_]+)\1\s*\)$/;
const ML_CALL_ANYWHERE = /ml\.t\(\s*(["'`])([A-Za-z0-9_]+)\1\s*\)/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const LOAD_TEMPLATE_LITERAL =
	/IOTOLoadTemplate(?:\.load)?\([\s\S]*?["']([^"']+)["']/;

function isQuoted(value: string): boolean {
	const first = value[0];
	return (
		value.length >= 2 &&
		(first === '"' || first === "'" || first === "`") &&
		value.endsWith(first)
	);
}

/** 取 `const <id> = <右值>`；右值停在分号或换行，够覆盖本库的全部写法。 */
function findConstRightHand(content: string, identifier: string): string | null {
	const regex = new RegExp(
		`const\\s+${identifier}\\s*=\\s*([^;\\n]+)`,
	);
	const match = regex.exec(content);
	return match?.[1] ? match[1].trim() : null;
}

function classifyIdentifier(
	value: string,
	ml: Ml,
	content: string,
): BindingParse {
	const rhs = findConstRightHand(content, value);
	if (rhs === null) {
		return { kind: "unresolved", raw: value, reason: "unknown-identifier" };
	}

	const mlCall = ML_CALL_ANYWHERE.exec(rhs);
	if (mlCall?.[2]) {
		return {
			kind: "name",
			name: ml.t(mlCall[2]),
			via: "identifier-mlt",
			key: mlCall[2],
		};
	}

	const loadCall = LOAD_TEMPLATE_LITERAL.exec(rhs);
	if (loadCall?.[1]) {
		return {
			kind: "name",
			name: loadCall[1],
			via: "identifier-literal",
			key: null,
		};
	}

	if (isQuoted(rhs)) {
		const inner = rhs.slice(1, -1);
		if (inner === "") return { kind: "none" };
		if (rhs.startsWith("`") && inner.includes("${")) {
			return { kind: "unresolved", raw: value, reason: "dynamic-expression" };
		}
		return { kind: "name", name: inner, via: "literal", key: null };
	}

	return { kind: "unresolved", raw: value, reason: "unknown-identifier" };
}

function classifyValue(
	token: string,
	ml: Ml,
	content: string,
): BindingParse {
	const value = token.trim();
	if (!value) return { kind: "none" };

	if (isQuoted(value)) {
		const inner = value.slice(1, -1);
		if (value.startsWith("`") && inner.includes("${")) {
			return { kind: "unresolved", raw: value, reason: "dynamic-expression" };
		}
		if (inner === "") return { kind: "none" };
		return { kind: "name", name: inner, via: "literal", key: null };
	}

	const mlCall = ML_CALL.exec(value);
	if (mlCall?.[2]) {
		return {
			kind: "name",
			name: ml.t(mlCall[2]),
			via: "mlt",
			key: mlCall[2],
		};
	}

	if (IDENTIFIER.test(value)) return classifyIdentifier(value, ml, content);

	return { kind: "unresolved", raw: value, reason: "dynamic-expression" };
}

/**
 * 读 `const noteSettings = {...}` 的 `template` 字段。
 *
 * 只做语法级提取：块里有 `tp.file.selection()`、`parseInt(...)` 这类调用，
 * 求值必炸；白名单四种形态之外一律报 unresolved。
 */
export function parseSelectorBinding(content: string, ml: Ml): BindingParse {
	const block = findBracedBlock(content, "noteSettings");
	if (!block) {
		return { kind: "unresolved", raw: "", reason: "no-note-settings" };
	}

	const field = splitTopLevel(block.slice(1, -1))
		.map((entry) => /^\s*["']?template["']?\s*:([\s\S]*)$/.exec(entry))
		.find((match) => match !== null);
	if (!field) {
		return { kind: "unresolved", raw: "", reason: "no-template-field" };
	}

	return classifyValue(field[1] ?? "", ml, content);
}

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
