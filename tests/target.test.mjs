/**
 * 地图 → 生成器定位算法单测（Plan-20261018-105535 §4.9）。
 *
 * 只锁降级顺序：模板值唯一命中 → 规则序号 → null。
 * DOM 与真机跳转走手工验收，不在这里模拟。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const { pickSwitcherRow } = await jiti.import(
	'../src/services/template-map/target.ts',
);

test('模板值唯一命中时优先于偏移的规则序号', () => {
	const rows = [
		{ index: 1, template: 'TP-A' },
		{ index: 2, template: 'TP-B' },
	];
	// 行内注释把序号前移了一行：地图说 #2，实际模板在第 1 行
	assert.deepEqual(
		pickSwitcherRow(rows, { ruleIndex: 2, template: 'TP-A' }),
		rows[0],
	);
});

test('模板值命中两行时退回规则序号', () => {
	const rows = [
		{ index: 1, template: 'TP-SAME' },
		{ index: 2, template: 'TP-SAME' },
		{ index: 3, template: 'TP-OTHER' },
	];
	assert.deepEqual(
		pickSwitcherRow(rows, { ruleIndex: 3, template: 'TP-SAME' }),
		rows[2],
	);
});

test('模板值缺失时按规则序号取行', () => {
	const rows = [
		{ index: 1, template: 'TP-A' },
		{ index: 2, template: '' },
	];
	assert.deepEqual(
		pickSwitcherRow(rows, { ruleIndex: 2, template: null }),
		rows[1],
	);
});

test('模板值落空且序号越界时返回 null', () => {
	const rows = [{ index: 1, template: 'TP-A' }];
	assert.equal(
		pickSwitcherRow(rows, { ruleIndex: 4, template: 'TP-Z' }),
		null,
	);
});
