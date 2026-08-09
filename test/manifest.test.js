const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PUBLISHED_REPOSITORY = 'https://github.com/yanghui040701/uniapp-auto-save-plugin';
const PUBLISHED_ISSUES = 'https://github.com/yanghui040701/uniapp-auto-save-plugin/issues';

test('manifest declares the exact plugin identity and entry point', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.id, 'yanghui-auto-save');
  assert.equal(manifest.name, 'HBuilderX Auto Save');
  assert.equal(manifest.version, '1.0.1');
  assert.equal(manifest.displayName, '编辑时自动保存');
  assert.equal(
    manifest.description,
    '为 HBuilderX 提供编辑时防抖自动保存，并可引导开启原生失焦自动保存，避免快速切换文件时遗漏保存。'
  );
  assert.equal(manifest.publisher, 'yanghui040701');
  assert.equal(manifest.repository, PUBLISHED_REPOSITORY);
  assert.equal(manifest.bugs, PUBLISHED_ISSUES);
  assert.equal(manifest.main, './extension');
  assert.deepEqual(manifest.activationEvents, ['*']);
  assert.equal(manifest.engines.HBuilderX, '^3.2.3');
  assert.equal(manifest.contributes.configuration.title, '编辑时自动保存');
  assert.equal(
    manifest.contributes.commands[0].command,
    'yanghui-auto-save.checkFocusSave'
  );
  assert.equal(
    manifest.contributes.commands[0].title,
    '编辑时自动保存：检查并开启 HBuilderX 原生失焦保存'
  );
});

test('manifest exposes only the two approved user settings', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const properties = manifest.contributes.configuration.properties;
  assert.deepEqual(Object.keys(properties).sort(), [
    'hbuilderx-auto-save.delay',
    'hbuilderx-auto-save.enabled'
  ]);
  assert.equal(properties['hbuilderx-auto-save.enabled'].default, true);
  assert.equal(properties['hbuilderx-auto-save.delay'].default, 1000);
});

test('manifest declares privacy, ads, and permission status', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dcloudext.declaration, {
    ads: '无',
    data: '无',
    permissions: '无'
  });
});
