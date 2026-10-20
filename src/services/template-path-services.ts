/**
 * 模板落点解析（Plan-20261020-154728 S1）。
 *
 * 纯函数：不 import `obsidian`，也不 import `lang`。
 * 目录名（选择器模板 / SelectorTemplates …）一律由调用方用 `t()` 取好传进来，
 * 这样 `<前缀>IOTO` 的内部结构天然跟随界面语言，本模块里没有任何中文字面量。
 *
 * 判定只看「保存那一刻的最终文件名」：`basename === prefix` 或
 * `basename.startsWith(prefix + "-")`。这样前缀 `J` 不会吞掉 `JSON-*`。
 */

export type TemplateKind = "Selector" | "Switcher" | "Note";

/** 每类模板对应的内部目录名 i18n key，调用方据此 `t()` 后传入 `kindFolderName`。 */
export const TEMPLATE_KIND_FOLDER_KEY = {
	Selector: "SELECTOR_FOLDER_NAME",
	Switcher: "SWITCHER_FOLDER_NAME",
	Note: "NOTE_TEMPLATES_FOLDER_NAME",
} as const;

/** 框架自带的用户目录名；`<前缀>IOTO` 与它同级。 */
export const DEFAULT_USER_FOLDER_NAME = "MyIOTO";

export interface ResolveInput {
	/** 最终文件名，不含 `.md` */
	name: string;
	kind: TemplateKind;
	/** `normalizePrefix` 的结果；null = 不分流 */
	prefix: string | null;
	/** 设置里的默认落点，如 `settings.selectorFolderPath` */
	configuredFolder: string;
	/** Templater `templates_folder`，可为空串 */
	templaterRoot: string;
	/** ioto-settings 的 `IOTOFrameworkPath`，可为空串 */
	frameworkRoot: string;
	/** 由调用方 `t(TEMPLATE_KIND_FOLDER_KEY[kind])` 得到，不可写死 */
	kindFolderName: string;
}

/**
 * 归一化用户前缀：trim → 剥掉尾随 `-` → 空或含路径分隔符则视为「不分流」。
 * 剥尾横线是为了避免拼出 `JL--TP-…`。
 */
export function normalizePrefix(raw?: string | null): string | null {
	if (typeof raw !== "string") return null;
	let prefix = raw.trim();
	while (prefix.endsWith("-")) {
		prefix = prefix.slice(0, -1).trim();
	}
	if (!prefix) return null;
	if (prefix.includes("/") || prefix.includes("\\")) return null;
	return prefix;
}

/** 文件名是否带用户前缀（裸前缀本身也算）。 */
export function isUserPrefixed(name: string, prefix: string): boolean {
	if (!name || !prefix) return false;
	return name === prefix || name.startsWith(`${prefix}-`);
}

/** 拼路径并吃掉重复/首尾斜杠。 */
function joinPath(...parts: Array<string | null | undefined>): string {
	return parts
		.filter((part): part is string => typeof part === "string")
		.join("/")
		.split("/")
		.filter((seg) => seg !== "")
		.join("/");
}

/** 路径里是否已有 `<前缀>IOTO` 这一段（整段匹配，避免 `JLIOTOX` 误判）。 */
function hasUserFolderSegment(folder: string, prefix: string): boolean {
	const target = `${prefix}IOTO`;
	return folder
		.split("/")
		.some((seg) => seg.trim() === target);
}

/**
 * 解析最终落点目录。判定顺序固定，改动会打破 §5 单测的语义：
 * 无前缀 / 路径型模板名 / 非本前缀 → 原配置目录；
 * 配置目录已在 `<前缀>IOTO` 下 → 原样返回（幂等，前缀 `My` 时不打散现有路径）；
 * 无根 → 原配置目录；否则 `<根>/<前缀>IOTO/<kindFolderName>`。
 */
export function resolveTemplateFolder(input: ResolveInput): string {
	const {
		name,
		prefix,
		configuredFolder,
		templaterRoot,
		frameworkRoot,
		kindFolderName,
	} = input;
	const fallback = configuredFolder ?? "";

	if (!prefix) return fallback;
	// 切换器的 `switchers[].template` 可能是路径而非文件名，不做分流
	if (typeof name === "string" && name.includes("/")) return fallback;
	if (!isUserPrefixed(name, prefix)) return fallback;
	if (hasUserFolderSegment(fallback, prefix)) return fallback;

	const root = templaterRoot?.trim()
		? templaterRoot.trim()
		: frameworkRoot?.trim()
			? joinPath(frameworkRoot.trim(), "Templates/Templater")
			: "";
	if (!root) return fallback;

	return joinPath(root, `${prefix}IOTO`, kindFolderName);
}

/**
 * 选择器扫描根：默认用户目录 + `<前缀>IOTO`，去重保序。
 * `file-picker` 用「任一根命中」，`includes` 再叠加名字收窄。
 */
export function templateSearchRoots(input: {
	templaterRoot: string;
	frameworkRoot: string;
	prefix: string | null;
}): string[] {
	const templaterRoot = (input.templaterRoot ?? "").trim();
	const frameworkRoot = (input.frameworkRoot ?? "").trim();
	const root = templaterRoot
		? templaterRoot
		: frameworkRoot
			? joinPath(frameworkRoot, "Templates/Templater")
			: "";
	if (!root) return [];

	const roots = [joinPath(root, DEFAULT_USER_FOLDER_NAME)];
	if (input.prefix) {
		const prefixed = joinPath(root, `${input.prefix}IOTO`);
		if (!roots.includes(prefixed)) roots.push(prefixed);
	}
	return roots;
}
