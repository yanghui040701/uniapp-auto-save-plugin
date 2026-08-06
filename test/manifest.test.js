const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('manifest declares the exact plugin identity and entry point', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.id, 'yanghui-auto-save');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.publisher, 'yanghui040701');
  assert.equal(manifest.main, './extension');
  assert.deepEqual(manifest.activationEvents, ['*']);
  assert.equal(manifest.engines.HBuilderX, '^3.2.3');
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
