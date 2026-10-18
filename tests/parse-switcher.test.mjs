/**
 * 切换器正文的解析锁定用例。
 *
 * 背景：新建选择器时插件会顺带创建一份「空切换器」并自动导入。旧实现用
 * 「视图当前页签」决定 parser，而此刻页签是 Selector，于是同一份文件走
 * `parseSwitcher` 完全可加载、走 `parseSelector` 必失败（missing-folder-settings）。
 *
 * 这里钉住三件事：
 * 1. 自动创建的正文能被 `parseSwitcher` 完整读出（生产与单测同源，改了模板就红）；
 * 2. 同一份正文喂 `parseSelector` 必失败 —— 这就是「调用方必须显式声明类型」的理由；
 * 3. 真实切换器的非空规则（frontMatter / switchers / pathMode / 小写 for 归一）。
 *
 * 「保存后是否真的切到 Switcher 页」属于 UI 接线，用 dev:errors + 手工验收，
 * 见 Report-20261018-102223。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const { ScriptEngine } = await jiti.import('../src/processors/ScriptEngine.ts');
const { createEmptySwitcherContent } = await jiti.import(
	'../src/processors/switcherTemplate.ts',
);

const switcherFixture = (name) =>
	readFile(
		new URL(`./fixtures/switchers/${encodeURIComponent(name)}`, import.meta.url),
		'utf8',
	);

// —— 1. 自动创建的正文 ——

test('自动创建的切换器正文：parseSwitcher 读出完整空配置', async () => {
	const result = ScriptEngine.parseSwitcher(createEmptySwitcherContent('Custom'));

	assert.equal(result.type, 'Switcher');
	assert.equal(result.usage, 'Custom');
	assert.deepEqual(result.folderSettings, {
		sharedFrontMatters: {},
		switchers: [],
		useFullPath: false,
		defaultTemplateName: '',
		defaultTemplate: '',
	});
});

// —— 2. 同一份正文喂错 parser ——

test('同一份正文喂 parseSelector：必须显式失败，且不返回半份配置', async () => {
	// 这条断言就是「importTemplate 必须由调用方声明 expectedType」的理由：
	// 自动导入发生在 Selector 页，若仍按页签分派，这个文件必然走这里。
	const result = ScriptEngine.parseSelector(createEmptySwitcherContent('Custom'));

	assert.equal(result.failure.code, 'missing-folder-settings');
	assert.equal(result.folderSettings, null);
	assert.equal(result.noteSettings, null);
});

// —— 3. 真实切换器 ——

test('真实切换器：非空规则与 for 大小写归一都保持', async () => {
	const input = ScriptEngine.parseSwitcher(
		await switcherFixture('JL-TP-输入-切换器-创建输入笔记.md'),
	);

	assert.equal(input.type, 'Switcher');
	assert.equal(input.usage, 'Input');
	assert.equal(input.folderSettings.switchers.length, 3);
	assert.equal(input.folderSettings.useFullPath, false);
	// 共享 frontMatter 里的 Project 会被剔除，只留脚本写入的其他键
	assert.ok(!('Project' in input.folderSettings.sharedFrontMatters));

	const other = ScriptEngine.parseSwitcher(
		await switcherFixture('JL-TP-自定义-切换器-其他.md'),
	);

	// 源文件写的是 `** for: custom`，首字母大写归一后才是 Usage
	assert.equal(other.usage, 'Custom');
	assert.equal(other.type, 'Switcher');
});
