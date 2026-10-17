/**
 * 从 `IOTOMultiLangs.js` 抽多语言字典并复刻 `t()`。
 *
 * 运行时词典内嵌在脚本里，没有 JSON 真源，所以这里用括号配对抽对象体，
 * 而不是用正则截断（字典里有 `}` 字符会立刻截错）。
 */

export type Locale = "en" | "zh-cn" | "zh-tw";

export interface MlDicts {
	en: Record<string, string>;
	"zh-cn": Record<string, string>;
	"zh-tw": Record<string, string>;
}

export interface Ml {
	t(key: string, vars?: Record<string, string | number>): string;
}

export function normalizeLocale(raw: string | null | undefined): Locale {
	if (!raw) return "en";
	const value = String(raw).toLowerCase().replace(/_/g, "-");
	if (
		value === "zh" ||
		value.startsWith("zh-cn") ||
		value.startsWith("zh-hans") ||
		value.startsWith("zh-sg")
	) {
		return "zh-cn";
	}
	if (
		value.startsWith("zh-tw") ||
		value.startsWith("zh-hk") ||
		value.startsWith("zh-mo") ||
		value.startsWith("zh-hant")
	) {
		return "zh-tw";
	}
	return "en";
}

/**
 * 找到 `xxxDict(){return{...}}` 的对象体。返回含大括号的原文。
 */
function extractDictBody(source: string, method: string): string | null {
	const regex = new RegExp(
		`\\b${method}\\s*\\(\\s*\\)\\s*\\{\\s*return\\s*\\{`,
	);
	const match = regex.exec(source);
	if (!match || match.index === undefined) return null;

	const start = match.index + match[0].length - 1;
	const end = findMatchingBrace(source, start);
	if (end === -1) return null;
	return source.slice(start, end + 1);
}

/**
 * 括号配对扫描：跳过单/双引号、模板串与注释，避免字典里的 `}` 提前收尾。
 */
export function findMatchingBrace(source: string, start: number): number {
	if (source[start] !== "{") return -1;

	let depth = 0;
	let quote: string | null = null;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = start; index < source.length; index++) {
		const char = source[index] ?? "";
		const next = source[index + 1] ?? "";

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

		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) return index;
		}
	}

	return -1;
}

export function extractMlDicts(source: string): MlDicts | null {
	const bodies: Record<Locale, string | null> = {
		en: extractDictBody(source, "enDict"),
		"zh-cn": extractDictBody(source, "zhcnDict"),
		"zh-tw": extractDictBody(source, "zhtwDict"),
	};

	const result: Partial<MlDicts> = {};
	for (const locale of ["en", "zh-cn", "zh-tw"] as Locale[]) {
		const body = bodies[locale];
		if (!body) return null;
		try {
			// 字典体是脚本源码，只能求值；失败已整体降级为 null。
			// eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
			const parsed: unknown = new Function(`return (${body});`)();
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return null;
			}
			result[locale] = parsed as Record<string, string>;
		} catch {
			return null;
		}
	}

	return result as MlDicts;
}

/** 逐字复刻 IOTOMultiLangs.t：当前语言 -> en -> 原始 key；两种占位都替换。 */
export function createMl(dicts: MlDicts, locale: string): Ml {
	const local = normalizeLocale(locale);
	const dict = dicts[local];
	const fallback = dicts.en;

	return {
		t(key: string, vars?: Record<string, string | number>): string {
			if (key === null || key === undefined) return "";
			const value = dict[key] ?? fallback[key];
			if (value === undefined) return key;
			let output = value;
			if (vars) {
				for (const [name, replacement] of Object.entries(vars)) {
					const text = String(replacement);
					output = output
						.split(`{{${name}}}`)
						.join(text)
						.split(`%${name}%`)
						.join(text);
				}
			}
			return output;
		},
	};
}

/** 字典抽取失败时的降级实现：显示原始键名，让页面仍然可用。 */
export function createPassthroughMl(): Ml {
	return {
		t(key: string): string {
			return key;
		},
	};
}
