import type { TFile } from "obsidian";
import type { FileRef, FolderStatus, ResolveVia } from "./types";

/**
 * 前缀回退、排除匹配、规则命中、状态判定。
 *
 * 这些函数必须与 `0-辅助/IOTO/Scripts/IOTOGetFolderOption.js` 和
 * `IOTOLoadTemplate.js` 逐字对齐（含「带 `-` 前缀为白名单」这一反直觉语义），
 * 且不 import obsidian 运行时，单测可直接 import。
 */

export interface ResolveContext {
	/** 对应 `metadataCache.getFirstLinkpathDest(normalizePath(name), "")` */
	lookup(name: string): TFile | null;
	prefix: string;
	useUserTemplate: boolean;
}

/** 与 IOTOLoadTemplate.resolveTemplateName 的三级顺序一致。 */
export function candidateNames(
	name: string,
	prefix: string,
	useUserTemplate: boolean,
): string[] {
	if (!useUserTemplate) return [name];
	const userPrefix = prefix || "My";
	const raw = [`${userPrefix}-${name}`, `My-${name}`, name];
	return raw.filter((item, index) => raw.indexOf(item) === index);
}

export function resolveName(name: string, ctx: ResolveContext): FileRef {
	const candidates = candidateNames(name, ctx.prefix, ctx.useUserTemplate);
	const attempts: { name: string; via: ResolveVia }[] = ctx.useUserTemplate
		? [
				{ name: `${ctx.prefix || "My"}-${name}`, via: "prefix" },
				{ name: `My-${name}`, via: "my" },
				{ name, via: "plain" },
			]
		: [{ name, via: "direct" }];

	for (const attempt of attempts) {
		const file = ctx.lookup(attempt.name);
		if (file) {
			return { name, file, via: attempt.via, candidates };
		}
	}

	const last = attempts[attempts.length - 1];
	return {
		name,
		file: null,
		via: last ? last.via : "plain",
		candidates,
	};
}

function normalizePathLike(value: string): string {
	return value.replace(/\\/g, "/");
}

/** `IOTOGetFolderOption.isPathUnder`：path 是否位于 base 之内（含自身）。 */
export function isPathUnder(path: string, base: string): boolean {
	if (!path || !base) return false;
	const p = normalizePathLike(path);
	const b = normalizePathLike(base).replace(/\/$/, "");
	return p === b || p.startsWith(`${b}/`);
}

/** `IOTOGetFolderOption.isSegmentMatch`：整段全等，允许出现在路径任意连续区间。 */
export function isSegmentMatch(path: string, pattern: string): boolean {
	if (!path || !pattern) return false;
	const segments = normalizePathLike(path).split("/").filter(Boolean);
	const target = normalizePathLike(pattern)
		.replace(/\/$/, "")
		.split("/")
		.filter(Boolean);
	if (target.length === 0) return false;
	if (segments.join("/") === target.join("/")) return true;

	for (let start = 0; start <= segments.length - target.length; start++) {
		if (target.every((segment, offset) => segments[start + offset] === segment)) {
			return true;
		}
	}
	return false;
}

/** `IOTOGetFolderOption.isSegmentFuzzyMatch`：段内子串、按顺序匹配。 */
export function isSegmentFuzzyMatch(path: string, pattern: string): boolean {
	if (!path || !pattern) return false;
	const segments = normalizePathLike(path).split("/").filter(Boolean);
	const target = normalizePathLike(pattern)
		.replace(/\/$/, "")
		.split("/")
		.filter(Boolean);
	if (target.length === 0) return false;
	if (segments.join("/") === target.join("/")) return true;

	let cursor = 0;
	for (const segment of target) {
		while (cursor < segments.length && !(segments[cursor] ?? "").includes(segment)) {
			cursor++;
		}
		if (cursor >= segments.length) return false;
		cursor++;
	}
	return true;
}

/**
 * `excludesPaths` 的每一行：`-` 开头是白名单（只保留命中项），其余是排除。
 * 空行忽略。
 */
export function splitExcludeRules(raw: string): {
	raw: string;
	include: boolean;
}[] {
	if (!raw) return [];
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => ({ raw: line, include: line.startsWith("-") }));
}

export function folderVisible(
	path: string,
	rules: { raw: string; include: boolean }[],
	matchMode: "segment" | "fuzzy",
): { visible: boolean; excludedBy: string | null } {
	const matcher = matchMode === "segment" ? isSegmentMatch : isSegmentFuzzyMatch;
	const includes = rules.filter((rule) => rule.include);
	const excludes = rules.filter((rule) => !rule.include);

	if (includes.length > 0) {
		const hit = includes.some((rule) => matcher(path, rule.raw.slice(1)));
		if (!hit) {
			const gate = includes[0];
			return { visible: false, excludedBy: gate ? gate.raw : null };
		}
	}

	const blocked = excludes.find((rule) => matcher(path, rule.raw));
	if (blocked) return { visible: false, excludedBy: blocked.raw };

	return { visible: true, excludedBy: null };
}

/** 切换器里的 `prefix`：pathMode 用完整路径，否则用叶子名。 */
export function folderPrefix(path: string, pathMode: boolean): string {
	if (pathMode) return path;
	const parts = path.split("/");
	return parts[parts.length - 1] ?? path;
}

/** `switchers.find(item => prefix.includes(item.match))`，顺序优先。 */
export function pickRule(
	prefix: string,
	rules: { match: string }[],
): number | null {
	for (let index = 0; index < rules.length; index++) {
		const match = rules[index]?.match ?? "";
		if (prefix.includes(match)) return index;
	}
	return null;
}

export function classify(args: {
	excluded: boolean;
	ruleIndex: number | null;
	match: string | null;
	hasTemplate: boolean;
}): FolderStatus {
	if (args.excluded) return "excluded";
	if (args.ruleIndex === null) return "fallback";
	if ((args.match ?? "") === "") return "empty-match";
	return args.hasTemplate ? "matched" : "matched-missing";
}
