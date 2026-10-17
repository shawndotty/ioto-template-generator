/**
 * 模板地图解析层单测（Plan-20261017-211001 §5）。
 *
 * 只锁语义：match 集合、顺序、前缀回退、locale、状态判定。
 * DOM 与真机行为走手工验收，不在这里模拟。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const {
	candidateNames,
	resolveName,
	isSegmentMatch,
	isSegmentFuzzyMatch,
	splitExcludeRules,
	folderVisible,
	pickRule,
	classify,
} = await jiti.import('../src/services/template-map/resolver.ts');

const { extractMlDicts, createMl, normalizeLocale } = await jiti.import(
	'../src/services/template-map/multilang.ts',
);

const { parseSwitcherRules, parseFolderSettings, parseHeader, parseSelectorBinding } =
	await jiti.import('../src/services/template-map/parser.ts');

const fixture = (group, name) =>
	readFile(
		new URL(`./fixtures/${group}/${encodeURIComponent(name)}`, import.meta.url),
		'utf8',
	);

/** 与 parse-selector.test.mjs 同源的 ioto-settings 快照。 */
const settingsStub = {
	inputFolder: '1-输入',
	outputFolder: '2-输出',
	outcomeFolder: '4-成果',
	taskFolder: '3-任务',
	inputSelectorExcludesPaths: '',
	inputSelectorShowOptionOrder: true,
	inputSelectorShowBasePath: false,
	inputSelectorFolderOptionTemplate: '在 {{folder}} 中创建输入笔记',
	outputSelectorExcludesPaths: '',
	outputSelectorShowOptionOrder: true,
	outputSelectorShowBasePath: false,
	outputSelectorFolderOptionTemplate: '在 {{folder}} 中创建输出笔记',
	taskSelectorExcludesPaths: '',
	taskSelectorShowOptionOrder: true,
	taskSelectorShowBasePath: false,
	taskSelectorFolderOptionTemplate: '在 {{folder}} 中创建任务列表',
	outcomeSelectorExcludesPaths: '',
	outcomeSelectorShowOptionOrder: true,
	outcomeSelectorShowBasePath: false,
	outcomeSelectorFolderOptionTemplate: '在 {{folder}} 中创建成果笔记',
	outcomeSelectorIncludeParentFolder: true,
	outcomeProjectDefaultSubFolders: '文章\n代码片段',
};

/** 与运行时字典同形的迷你桩；只保留断言用到的键。 */
const mlMap = {
	Input: '输入',
	Output: '输出',
	Task: '任务',
	Outcome: '成果',
	OriginalSource: '原始资料',
	Clips: '碎片笔记',
	Articles: '文章',
	Reports: '报告',
	IOTODefaultCustomNoteTemplate: 'TP-自定义-笔记-默认模板',
};
const ml = { t: (key) => mlMap[key] ?? key };

// —— 1-3. 前缀回退 ——

test('candidateNames：JL 前缀给出三级候选', () => {
	assert.deepEqual(candidateNames('TP-输入-原始资料', 'JL', true), [
		'JL-TP-输入-原始资料',
		'My-TP-输入-原始资料',
		'TP-输入-原始资料',
	]);
});

test('resolveName：三级各命中一次时 via 分别为 prefix / my / plain', () => {
	const ctx = (found) => ({
		prefix: 'JL',
		useUserTemplate: true,
		lookup: (name) => (found.includes(name) ? { path: name } : null),
	});

	assert.equal(
		resolveName('TP-x', ctx(['JL-TP-x'])).via,
		'prefix',
	);
	assert.equal(
		resolveName('TP-x', ctx(['My-TP-x'])).via,
		'my',
	);
	assert.equal(resolveName('TP-x', ctx(['TP-x'])).via, 'plain');
});

test('resolveName：useUserTemplate=false 只试原名', () => {
	const ref = resolveName('TP-x', {
		prefix: 'JL',
		useUserTemplate: false,
		lookup: () => null,
	});

	assert.deepEqual(ref.candidates, ['TP-x']);
	assert.equal(ref.via, 'direct');
	assert.equal(ref.file, null);
});

// —— 4-5. 排除匹配语义 ——

test('isSegmentFuzzyMatch：段内子串按顺序匹配', () => {
	assert.equal(isSegmentFuzzyMatch('4-成果/P/文章', '文章'), true);
	assert.equal(isSegmentFuzzyMatch('4-成果/P/文章集', '文章'), true);
	assert.equal(isSegmentFuzzyMatch('4-成果/P/报告', '文章'), false);
});

test('isSegmentMatch：整段全等', () => {
	assert.equal(isSegmentMatch('4-成果/P/文章集', '文章'), false);
	assert.equal(isSegmentMatch('4-成果/P/文章', '文章'), true);
});

// —— 6-7. excludesPaths ——

test('splitExcludeRules：- 前缀是白名单，其余是排除', () => {
	const rules = splitExcludeRules('-3-任务/Demo\n3-任务/Demo/归档');
	assert.equal(rules.length, 2);
	assert.equal(rules[0].include, true);
	assert.equal(rules[0].raw, '-3-任务/Demo');
	assert.equal(rules[1].include, false);
});

test('folderVisible：白名单存在但路径不在其中 -> 不可见并给出该行', () => {
	const rules = splitExcludeRules('-3-任务/Demo');
	const result = folderVisible('3-任务/其他', rules, 'fuzzy');

	assert.equal(result.visible, false);
	assert.equal(result.excludedBy, '-3-任务/Demo');
});

// —— 8-10. 规则命中与状态 ——

test('pickRule：空 match 恒真，顺序优先', () => {
	assert.equal(
		pickRule('任意', [{ match: 'zzz' }, { match: '' }]),
		1,
	);
});

test('pickRule：子串遮蔽时返回靠前的那条', () => {
	assert.equal(
		pickRule('学习AI资料', [{ match: '学习' }, { match: '学习AI' }]),
		0,
	);
});

test('classify：五条分支各一次', () => {
	assert.equal(
		classify({ excluded: true, ruleIndex: 0, match: 'a', hasTemplate: true }),
		'excluded',
	);
	assert.equal(
		classify({ excluded: false, ruleIndex: 1, match: '', hasTemplate: true }),
		'empty-match',
	);
	assert.equal(
		classify({ excluded: false, ruleIndex: 0, match: 'a', hasTemplate: true }),
		'matched',
	);
	assert.equal(
		classify({ excluded: false, ruleIndex: 0, match: 'a', hasTemplate: false }),
		'matched-missing',
	);
	assert.equal(
		classify({ excluded: false, ruleIndex: null, match: null, hasTemplate: false }),
		'fallback',
	);
});

// —— 11-14. 切换器解析 ——

test('parseSwitcherRules：JL 输入切换器 3 条，match 已折算', async () => {
	const content = await fixture(
		'switchers',
		'JL-TP-输入-切换器-创建输入笔记.md',
	);
	const parsed = parseSwitcherRules(content, ml);

	assert.equal(parsed.error, null);
	assert.equal(parsed.rules.length, 3);
	assert.deepEqual(
		parsed.rules.map((rule) => rule.match),
		['原始资料', '碎片笔记', 'AI生成'],
	);
	assert.deepEqual(
		parsed.rules.map((rule) => rule.templateName),
		['TP-输入-原始资料', 'TP-输入-碎片笔记', 'JL-TP-输入-AI生成'],
	);
	assert.equal(parsed.pathMode, false);
});

test('parseSwitcherRules：My 任务切换器只有 1 条 Demo，模板名折算任务', async () => {
	const content = await fixture(
		'switchers',
		'My-TP-任务-切换器-创建任务列表.md',
	);
	const parsed = parseSwitcherRules(content, ml);

	assert.equal(parsed.error, null);
	assert.equal(parsed.pathMode, false);
	assert.equal(parsed.rules.length, 1);
	assert.equal(parsed.rules[0].match, 'Demo');
	assert.equal(parsed.rules[0].templateName, 'My-TP-任务-Demo');
});

test('parseSwitcherRules：单条求值失败只影响该条', () => {
	const content = [
		'/** type: switcher */',
		'const switchers = [',
		'\t{ match: "A", template: "T-A" },',
		'\t{ match: `${unknownVar}`, template: "T-B" }',
		'];',
	].join('\n');
	const parsed = parseSwitcherRules(content, ml);

	assert.equal(parsed.rules.length, 2);
	assert.equal(parsed.rules[0].match, 'A');
	assert.equal(parsed.rules[0].templateName, 'T-A');
	assert.equal(parsed.rules[1].match, null);
	assert.ok(parsed.rules[1].unresolved.length > 0);
});

// —— 15-17. folderSettings 求值 ——

test('parseFolderSettings：成果选择器拿到真实基址与父文件夹开关', async () => {
	const content = await fixture('selectors', 'My-TP-选择器-创建成果.md');
	const parsed = parseFolderSettings(content, settingsStub);

	assert.equal(parsed.error, null);
	assert.equal(parsed.value.folderPath, '4-成果');
	assert.equal(parsed.value.includeParentFolder, true);
	assert.equal(parsed.value.showSubFolders, true);
});

test('parseFolderSettings：碎片笔记是字面量路径且不展开子文件夹', async () => {
	const content = await fixture(
		'selectors',
		'JL-TP-选择器-创建输入-碎片笔记.md',
	);
	const parsed = parseFolderSettings(content, settingsStub);

	assert.equal(parsed.error, null);
	assert.equal(parsed.value.folderPath, '1-输入/碎片笔记');
	assert.equal(parsed.value.showSubFolders, false);
	assert.deepEqual(parsed.value.excludesPaths, []);
});

test('parseFolderSettings：空作用域显式报错，不返回半份配置', async () => {
	const content = await fixture('selectors', 'My-TP-选择器-创建输入.md');
	const parsed = parseFolderSettings(content, {});

	assert.equal(parsed.value, null);
	assert.ok(parsed.error);
	assert.match(parsed.error, /inputFolder/);
});

// —— 18-20. 多语言字典 ——

const miniSource = `
class IOTOMultiLangs {
	enDict(){return{Input:"Input",Output:"Output",Task:"Task",Outcome:"Outcome",OriginalSource:"Original Source",TemplateNotExist:"The template does not exist: %template%"}}
	zhcnDict(){return{Input:"输入",Output:"输出",Task:"任务",Outcome:"成果",OriginalSource:"原始资料",TemplateNotExist:"模板不存在：{{template}}"}}
	zhtwDict(){return{Input:"輸入",Output:"輸出",Task:"任務",Outcome:"成果",OriginalSource:"原始資料",TemplateNotExist:"範本不存在：{{template}}"}}
}
`;

test('extractMlDicts：三语都取出核心键', () => {
	const dicts = extractMlDicts(miniSource);

	assert.ok(dicts);
	for (const locale of ['en', 'zh-cn', 'zh-tw']) {
		for (const key of ['Input', 'Output', 'Task', 'Outcome', 'OriginalSource']) {
			assert.equal(typeof dicts[locale][key], 'string', `${locale}.${key}`);
		}
	}
	assert.equal(dicts['zh-cn'].OriginalSource, '原始资料');
});

test('extractMlDicts：任一对象体损坏 -> 整体返回 null', () => {
	const broken = [
		'class IOTOMultiLangs {',
		'\tenDict(){return{Input:"Input"}}',
		'\tzhcnDict(){return{Input:"输入"',
		'\tzhtwDict(){return{Input:"輸入"}}',
		'}',
	].join('\n');

	const dicts = extractMlDicts(broken);
	assert.equal(dicts, null);
});

test('createMl：%k% 与 {{k}} 两种占位都替换，缺失键回落 en', () => {
	const dicts = extractMlDicts(miniSource);
	assert.ok(dicts);

	assert.equal(
		createMl(dicts, 'en').t('TemplateNotExist', { template: 'X' }),
		'The template does not exist: X',
	);
	assert.equal(
		createMl(dicts, 'zh-cn').t('TemplateNotExist', { template: 'X' }),
		'模板不存在：X',
	);
	assert.equal(createMl(dicts, 'fr').t('Input'), 'Input');
	assert.equal(createMl(dicts, 'zh-cn').t('NoSuchKey'), 'NoSuchKey');
});

test('normalizeLocale：运行时语言到三语桶', () => {
	assert.equal(normalizeLocale('zh-CN'), 'zh-cn');
	assert.equal(normalizeLocale('zh_hans'), 'zh-cn');
	assert.equal(normalizeLocale('zh-TW'), 'zh-tw');
	assert.equal(normalizeLocale('zh-Hant'), 'zh-tw');
	assert.equal(normalizeLocale('fr'), 'en');
	assert.equal(normalizeLocale(''), 'en');
});

// —— 21-30. 头注释与条目绑定（Plan-20261018-055232 §7） ——

const inlineSelector = (template, extra = '') =>
	[
		'<%*',
		'/*',
		'** type: selector',
		'** for: input',
		'*/',
		extra,
		'const noteSettings = {',
		`\ttemplate: ${template},`,
		'\taddLinkToTDL: false,',
		'}',
		'_%>',
	].join('\n');

test('parseHeader：自定义选择器是 selector / custom', async () => {
	const content = await fixture(
		'selectors',
		'JL-TP-选择器-创建自定义-其他.md',
	);
	assert.deepEqual(parseHeader(content), {
		type: 'selector',
		for: 'custom',
	});
});

test('parseHeader：大小写与空格容错，for 一律小写', () => {
	assert.deepEqual(parseHeader('/** Type: Selector */\n/** for :  Input */'), {
		type: 'selector',
		for: 'input',
	});
	assert.deepEqual(parseHeader('/** type: switcher */'), {
		type: 'switcher',
		for: null,
	});
	assert.deepEqual(parseHeader('no header'), { type: null, for: null });
});

test('parseSelectorBinding：自定义选择器是字面量切换器名', async () => {
	const content = await fixture(
		'selectors',
		'JL-TP-选择器-创建自定义-其他.md',
	);
	assert.deepEqual(parseSelectorBinding(content, ml), {
		kind: 'name',
		name: 'JL-TP-自定义-切换器-其他',
		via: 'literal',
		key: null,
	});
});

test('parseSelectorBinding：默认选择器跟随标识符拿到 ml.t 键', async () => {
	const content = await fixture('selectors', 'My-TP-选择器-创建输入.md');
	const parsed = parseSelectorBinding(content, ml);

	assert.equal(parsed.kind, 'name');
	assert.equal(parsed.via, 'identifier-mlt');
	assert.equal(parsed.key, 'IOTODefaultInputSwitcherTemplate');
	assert.equal(parsed.name, ml.t('IOTODefaultInputSwitcherTemplate'));
});

test('parseSelectorBinding：碎片笔记是字面量笔记模板', async () => {
	const content = await fixture(
		'selectors',
		'JL-TP-选择器-创建输入-碎片笔记.md',
	);
	assert.deepEqual(parseSelectorBinding(content, ml), {
		kind: 'name',
		name: 'My-TP-输入-碎片笔记',
		via: 'literal',
		key: null,
	});
});

test('parseSelectorBinding：空串表示不绑定模板', () => {
	assert.deepEqual(
		parseSelectorBinding(inlineSelector('""'), ml),
		{ kind: 'none' },
	);
	assert.deepEqual(
		parseSelectorBinding(
			inlineSelector('switcherTemplate', 'const switcherTemplate = "";'),
			ml,
		),
		{ kind: 'none' },
	);
});

test('parseSelectorBinding：未声明的标识符保留原文并报 unknown-identifier', () => {
	const parsed = parseSelectorBinding(inlineSelector('someVar'), ml);
	assert.equal(parsed.kind, 'unresolved');
	assert.equal(parsed.reason, 'unknown-identifier');
	assert.equal(parsed.raw, 'someVar');
});

test('parseSelectorBinding：动态表达式不做求值，原文照显', () => {
	const parsed = parseSelectorBinding(inlineSelector('tp.file.title'), ml);
	assert.equal(parsed.kind, 'unresolved');
	assert.equal(parsed.reason, 'dynamic-expression');
	assert.equal(parsed.raw, 'tp.file.title');

	const tmpl = parseSelectorBinding(inlineSelector('`a${b}`'), ml);
	assert.equal(tmpl.kind, 'unresolved');
	assert.equal(tmpl.reason, 'dynamic-expression');
});

test('parseSelectorBinding：缺字段与缺块给两种不同 reason', () => {
	const noField = parseSelectorBinding(
		'const noteSettings = {\n\tother: 1,\n}',
		ml,
	);
	assert.equal(noField.kind, 'unresolved');
	assert.equal(noField.reason, 'no-template-field');

	const noBlock = parseSelectorBinding('const x = 1', ml);
	assert.equal(noBlock.kind, 'unresolved');
	assert.equal(noBlock.reason, 'no-note-settings');
});

test('parseSwitcherRules：自定义切换器 1 条人物规则，兜底走 Custom 键', async () => {
	const content = await fixture(
		'switchers',
		'JL-TP-自定义-切换器-其他.md',
	);
	const parsed = parseSwitcherRules(content, ml);

	assert.equal(parsed.error, null);
	assert.equal(parsed.pathMode, false);
	assert.equal(parsed.rules.length, 1);
	assert.equal(parsed.rules[0].match, '人物');
	assert.equal(parsed.rules[0].templateName, 'JL-TP-自定义-人物');
	assert.equal(parsed.defaultTemplateName, 'TP-自定义-笔记-默认模板');
});
