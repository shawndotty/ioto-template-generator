/**
 * 模板落点解析单测（Plan-20261020-154728 §5）。
 *
 * 纯函数不依赖 obsidian；alias 只是沿用现有约定，防止将来误加 import 时直接炸。
 * DOM 与真实写盘走真机验收，不在这里模拟。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const {
	normalizePrefix,
	isUserPrefixed,
	resolveTemplateFolder,
	templateSearchRoots,
} = await jiti.import('../src/services/template-path-services.ts');

const CONFIGURED = 'T/MyIOTO/选择器模板';

/** 只关心目录分流时，root 默认为 `T`。 */
function resolve(overrides = {}) {
	return resolveTemplateFolder({
		name: 'JL-TP-A',
		kind: 'Selector',
		prefix: 'JL',
		configuredFolder: CONFIGURED,
		templaterRoot: 'T',
		frameworkRoot: '',
		kindFolderName: '选择器模板',
		...overrides,
	});
}

test('1. 带前缀的选择器落到 <前缀>IOTO', () => {
	assert.equal(resolve(), 'T/JLIOTO/选择器模板');
});

test('2. 内部目录名由调用方注入，不写死中文', () => {
	assert.equal(
		resolve({ kindFolderName: 'SelectorTemplates' }),
		'T/JLIOTO/SelectorTemplates',
	);
});

test('3. 非本前缀的文件名沿用原目录', () => {
	assert.equal(resolve({ name: 'My-TP-A' }), CONFIGURED);
});

test('4. 裸前缀本身也算带前缀', () => {
	assert.equal(resolve({ name: 'JL' }), 'T/JLIOTO/选择器模板');
});

test('5. 前缀 J 不吞掉 JLX-', () => {
	assert.equal(resolve({ prefix: 'J', name: 'JSON-TP-A' }), CONFIGURED);
});

test('6. 前缀为 My 时与改动前逐字符一致', () => {
	assert.equal(resolve({ prefix: 'My', name: 'My-TP-A' }), CONFIGURED);
});

test('7. 解析结果再解析一次不双嵌套（幂等）', () => {
	const once = resolve();
	const twice = resolve({ configuredFolder: once });
	assert.equal(twice, once);
});

test('8. 空前缀不分流', () => {
	assert.equal(resolve({ prefix: '' }), CONFIGURED);
	assert.equal(resolve({ prefix: '   ' }), CONFIGURED);
	assert.equal(resolve({ prefix: null }), CONFIGURED);
});

test('9. 前缀带尾横线时归一化，不拼出 JL--', () => {
	assert.equal(normalizePrefix('JL-'), 'JL');
	assert.equal(resolve({ prefix: normalizePrefix('JL-') }), 'T/JLIOTO/选择器模板');
});

test('10. 含路径分隔符的前缀视为非法', () => {
	assert.equal(normalizePrefix('J/L'), null);
	assert.equal(normalizePrefix('J\\L'), null);
	assert.equal(resolve({ prefix: normalizePrefix('J/L') }), CONFIGURED);
});

test('11. 路径型模板名不参与分流', () => {
	assert.equal(resolve({ name: 'a/b' }), CONFIGURED);
});

test('12. Templater 目录为空时回落框架路径', () => {
	assert.equal(
		resolve({ templaterRoot: '', frameworkRoot: 'F' }),
		'F/Templates/Templater/JLIOTO/选择器模板',
	);
});

test('13. 两个根都为空时不分流', () => {
	assert.equal(resolve({ templaterRoot: '', frameworkRoot: '' }), CONFIGURED);
});

test('14. 搜索根含默认目录与前缀目录', () => {
	assert.deepEqual(
		templateSearchRoots({
			templaterRoot: 'T',
			frameworkRoot: '',
			prefix: 'JL',
		}),
		['T/MyIOTO', 'T/JLIOTO'],
	);
	assert.deepEqual(
		templateSearchRoots({ templaterRoot: 'T', frameworkRoot: '', prefix: null }),
		['T/MyIOTO'],
	);
});

test('15. 搜索根在前缀为 My 时去重', () => {
	assert.deepEqual(
		templateSearchRoots({
			templaterRoot: 'T',
			frameworkRoot: '',
			prefix: 'My',
		}),
		['T/MyIOTO'],
	);
});

test('16. isUserPrefixed 只认前缀本体与「前缀-」', () => {
	assert.equal(isUserPrefixed('JL', 'JL'), true);
	assert.equal(isUserPrefixed('JL-TP-A', 'JL'), true);
	assert.equal(isUserPrefixed('JLX-TP-A', 'JL'), false);
	assert.equal(isUserPrefixed('My-TP-A', 'JL'), false);
});
