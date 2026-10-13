import test from 'node:test';
import assert from 'node:assert/strict';
import { callStatusText, probeSummaryText } from '../src/admin-diagnostics.ts';

test('completed calls describe returned tasks without claiming every node succeeded', () => {
  assert.equal(callStatusText('completed'), '任务已返回');
  const text = probeSummaryText({ expected: 3, returned: 2, measured: 1, partial: 1, timeout: 1, missing: 1, reached: 0, unreached: 1 });
  assert.equal(text, '节点返回 2/3 · 有效测量 1 · 部分结果 1 · 目标超时 1 · 未返回 1 · 未取得终点应答 1');
  assert.ok(!text.includes('全部成功'));
});

test('summary labels retain unknown destination and zero measurements without rendering arbitrary values', () => {
  assert.equal(probeSummaryText({ expected: 1, returned: 1, measured: 0, unknownDestination: 1 }), '节点返回 1/1 · 有效测量 0 · 目标地址未知 1');
  assert.equal(probeSummaryText({ expected: 'secret.example', returned: -1, measured: NaN, failed: Infinity, message: 'raw-secret' }), '');
  assert.equal(probeSummaryText(null), '');
});
