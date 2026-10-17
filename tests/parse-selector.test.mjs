/**
 * `parseSelector` 的导入行为 —— V262「静默失效」修复的锁定用例。
 *
 * 背景：旧实现对 `const folderSettings = {...}` 做裸求值，脚本头部从
 * `app.plugins.plugins["ioto-settings"].settings` 解构出来的变量在求值作用域里不存在，
 * 于是五份真实选择器里有四份直接抛 ReferenceError，被 `catch {}` 吞成 `{}`，
 * 调用方又把 `{}` 当成「全部使用默认值」——界面提示「已导入」，配置却全空。
 *
 * 这里钉住三件事：
 * 1. 带桩求值能拿到真实值（cases 1-5）；
 * 2. 字符串类字段要还原成 `${原始表达式}`，否则重新生成时会把设置值固化成字面量（cases 1-6、9）；
 * 3. 求值失败必须显式失败、不返回半份配置（cases 7、8、10）。
 *
 * 真机上「提示文案 / 表单是否保持原值」属于 UI 接线，用 dev:errors + 手工导入验收，
 * 见 Report-20261017-202249。
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

/**
 * 桩数据取自 `ioto-settings/data.json` 的快照（2026-10-17），只保留五份选择器引用到的键。
 * `inputSelectorExcludesPaths` 等排除路径故意留空串：三目分支正好走 `[]`。
 */
const settingsStub = {
	inputFolder: '1-输入',
	outputFolder: '2-输出',
	outcomeFolder: '4-成果',
	taskFolder: '3-任务',
	fleetingNoteFolder: '2-输出/闪念笔记',
	fleetingNotePrefix: '闪念',
	fleetingNoteDateFormat: 'YYYY-MM-DD',
	defaultTDLDateFormat: 'YYYY-WW-[W]',
	projectNameFormat: 'lastDash',
	inputSelectorExcludesPaths: '',
	inputSelectorShowOptionOrder: true,
	inputSelectorShowBasePath: false,
	inputSelectorFolderOptionTemplate: '在 {{folder}} 中创建输入笔记',
	inputNoteNamePrefix: '',
	inputNoteNamePostfix: '',
	inputNoteDefaultExcalidrawTemplate: '',
	newInputNoteFollowUpAction: '1',
	newInputNoteAddedToTDLFollowUpAction: '2',
	addNewInputNoteToTDL: true,
	outputSelectorExcludesPaths: '',
	outputSelectorShowOptionOrder: true,
	outputSelectorShowBasePath: false,
	outputSelectorFolderOptionTemplate: '在 {{folder}} 中创建输出笔记',
	outputNoteNamePrefix: '',
	outputNoteNamePostfix: '',
	outputNoteDefaultExcalidrawTemplate: '',
	newOutputNoteFollowUpAction: '1',
	newOutputNoteAddedToTDLFollowUpAction: '2',
	addNewOutputNoteToTDL: true,
	taskSelectorExcludesPaths: '',
	taskSelectorShowOptionOrder: true,
	taskSelectorShowBasePath: false,
	taskSelectorFolderOptionTemplate: '在 {{folder}} 中创建任务列表',
	taskSelectorEnableFutureDaysChoices: false,
	taskSelectorEnableSubjectTask: true,
	taskSelectorEnablePlanTask: true,
	taskSelectorEnableNormalTask: true,
	outcomeSelectorExcludesPaths: '',
	outcomeSelectorShowOptionOrder: true,
	outcomeSelectorShowBasePath: false,
	outcomeSelectorFolderOptionTemplate: '在 {{folder}} 中创建成果笔记',
	outcomeSelectorIncludeParentFolder: true,
	outcomeProjectDefaultSubFolders: '文章\n代码片段',
	outcomeNoteNamePrefix: '',
	outcomeNoteNamePostfix: '',
	outcomeNoteDefaultExcalidrawTemplate: '',
	newOutcomeNoteFollowUpAction: '1',
	newOutcomeNoteAddedToTDLFollowUpAction: '2',
	addNewOutcomeNoteToTDL: true,
};

/** 与 GeneratorView.buildImportStubs 同构；GeneratorView 自身依赖 DOM，单测里手工组装。 */
function buildStubs(overrides = {}) {
	return {
		...settingsStub,
		switcherTemplate: '',
		selectedText: '',
		activeFileBaseName: '',
		currentFolderPath: '',
		isInTaskFolder: false,
		onlyUseDateType: true,
		tR: '',
		ml: { t: (key) => key },
		tp: {
			file: { selection: () => '', folder: () => '', title: '' },
			config: { active_file: { basename: '' } },
			user: {},
		},
		app: {},
		...overrides,
	};
}

const fixture = (name) =>
	readFile(
		new URL(`./fixtures/selectors/${encodeURIComponent(name)}`, import.meta.url),
		'utf8',
	);

const parse = async (name, stubs = buildStubs()) =>
	ScriptEngine.parseSelector(await fixture(name), stubs);

// —— 1. 创建输入 ——

test('创建输入：路径/模板字段拿到真实值，字符串字段还原成表达式', async () => {
	const result = await parse('My-TP-选择器-创建输入.md');

	assert.equal(result.failure, null);
	assert.equal(result.usage, 'Input');
	assert.equal(result.type, 'Selector');

	const folder = result.folderSettings;
	assert.equal(folder.folderPath, '${inputFolder}');
	assert.equal(folder.showSubFolders, true);
	assert.deepEqual(folder.excludesPaths, []);
	assert.equal(folder.optionContentTemplate, '${inputSelectorFolderOptionTemplate}');
	assert.equal(folder.showBasePathInOption, false);
	assert.equal(folder.showOptionOrder, true);
});

// —— 2. 创建输入 · note ——

test('创建输入：note 段的模板与三目表达式都原样还原', async () => {
	const result = await parse('My-TP-选择器-创建输入.md');
	const note = result.noteSettings;

	assert.equal(note.template, '${switcherTemplate}');
	assert.equal(note.noteNamePrefix, '${inputNoteNamePrefix}');
	assert.equal(note.noteNamePostfix, '${inputNoteNamePostfix}');
	// 三目表达式必须整体还原：压成求值结果 "" 就等于悄悄丢了一个字段
	assert.equal(
		note.assignedNoteName,
		'${tp.file.selection() ? tp.file.selection().replace(/\\[|\\]/g,"") : ""}',
	);
	assert.equal(note.defaultNewNoteFollowUpAction, 1);
	assert.equal(note.addLinkToTDL, true);
	assert.equal(note.addLinkToTDLFollowUpAction, '2');
});

// —— 3. 创建输出 ——

test('创建输出：outputFolder 与闪念笔记相关字段', async () => {
	const result = await parse('My-TP-选择器-创建输出.md');

	assert.equal(result.failure, null);
	assert.equal(result.folderSettings.folderPath, '${outputFolder}');
	assert.equal(result.noteSettings.fleetingNoteFolder, '${fleetingNoteFolder}');
	assert.equal(result.noteSettings.fleetingNotePrefix, '${fleetingNotePrefix}');
	assert.equal(result.noteSettings.fleetingNoteDateFormat, '${fleetingNoteDateFormat}');
});

// —— 4. 创建成果 ——

test('创建成果：布尔/数组字段保留求值后的真实值', async () => {
	const result = await parse('My-TP-选择器-创建成果.md');
	const folder = result.folderSettings;

	assert.equal(result.failure, null);
	assert.equal(folder.isOutcomeSelector, true);
	assert.equal(folder.folderPath, '${outcomeFolder}');
	assert.equal(folder.taskFolder, '${taskFolder}');
	assert.equal(folder.includeParentFolder, true);
	// 数组控件没有「表达式」这一态，只能落成真实数组
	assert.deepEqual(folder.outcomeProjectDefaultSubFolders, ['文章', '代码片段']);
});

// —— 5. 创建任务 ——

test('创建任务：局部量桩让求值通过，Task 专属字段原样带出', async () => {
	const result = await parse('My-TP-选择器-创建任务.md');
	const note = result.noteSettings;

	assert.equal(result.failure, null);
	assert.equal(result.folderSettings.folderPath, '${taskFolder}');
	assert.equal(note.timestampFormat, '${defaultTDLDateFormat}');
	assert.equal(note.projectNameFormat, '${projectNameFormat}');
	assert.equal(note.taskType, 'date');
	assert.equal(note.upTask, null);
	assert.equal(note.template, '${switcherTemplate}');
	// enableFutureDaysChoices 是布尔，写入求值结果
	assert.equal(note.enableFutureDaysChoices, false);
});

// —— 6. 碎片笔记（全字面量 / 模板字面量） ——

test('碎片笔记：字面量路径与自定义切换器名都保留', async () => {
	const result = await parse('JL-TP-选择器-创建输入-碎片笔记.md');
	const folder = result.folderSettings;
	const note = result.noteSettings;

	assert.equal(result.failure, null);
	assert.equal(folder.folderPath, '1-输入/碎片笔记');
	assert.equal(folder.showSubFolders, false);
	assert.equal(note.template, 'My-TP-输入-碎片笔记');
	// 源文件本来就是反引号模板字面量：扁平化后 `${...}` 作为文本保留，不做二次包裹
	assert.equal(
		folder.optionContentTemplate,
		'${inputSelectorFolderOptionTemplate}',
	);
	assert.equal(note.assignedNoteName, '${tp.file.selection() ? tp.file.selection() : ""}');
});

// —— 7. 缺桩 ——

test('缺桩：显式失败，且不返回半份配置', async () => {
	const stubs = buildStubs();
	delete stubs.inputFolder;

	const result = await parse('My-TP-选择器-创建输入.md', stubs);

	assert.equal(result.failure.code, 'missing-identifier');
	assert.equal(result.failure.detail, 'inputFolder');
	assert.equal(result.folderSettings, null);
	assert.equal(result.noteSettings, null);
});

// —— 8. 非选择器内容 ——

test('非选择器内容：报 missing-folder-settings，而不是悄悄清空表单', async () => {
	const content = `/*\n** type: switcher\n** for: input\n*/\nconst frontMatter = { a: 1 };`;
	const result = ScriptEngine.parseSelector(content, buildStubs());

	assert.equal(result.failure.code, 'missing-folder-settings');
	assert.equal(result.folderSettings, null);
});

// —— 9. round-trip ——

test('round-trip：导入后再生成，路径仍是表达式而不是被固化的值', async () => {
	const result = await parse('My-TP-选择器-创建输入.md');
	const script = ScriptEngine.generateSelector(
		result.usage,
		result.folderSettings,
		result.noteSettings,
	);

	assert.match(script, /folderPath: `\$\{inputFolder\}`/);
	assert.match(script, /excludesPaths: \[\],/);
	assert.ok(!script.includes('"1-输入"'), '不得把 inputFolder 固化成字面量');
	assert.match(script, /template: `\$\{switcherTemplate\}`/);
});

// —— 10. `with` 锁 ——

test('with 锁：缺桩必须是 missing-identifier（函数体不能进严格模式）', async () => {
	// `with` 在严格模式下是 SyntaxError。若有人给 new Function 的函数体加 "use strict"，
	// 所有导入都会退化成 eval-error —— 这条断言就是那个预警器。
	const stubs = buildStubs();
	delete stubs.inputFolder;

	const result = await parse('My-TP-选择器-创建输入.md', stubs);

	assert.notEqual(result.failure.code, 'eval-error');
	assert.equal(result.failure.code, 'missing-identifier');
});
