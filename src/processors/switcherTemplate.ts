/**
 * 新建选择器时顺带创建的切换器正文。
 * 生产（ScriptPreviewModal）与单测共用同一函数，避免样例与模板各自维护后漂移。
 * 文件头 `** type` / `** for` 是 parseSwitcher 唯一的分派依据，改动需同步 tests/parse-switcher.test.mjs。
 */
export function createEmptySwitcherContent(usage: string): string {
	return `<%*\n/*\n** type: switcher\n** for: ${usage}\n*/\n_%>\n\n<%*\n\nconst frontMatter = {};\n\nconst switchers = [];\n\n_%>`;
}
