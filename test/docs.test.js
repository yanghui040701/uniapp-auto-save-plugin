const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const { MIN_DELAY, MAX_DELAY } = require('../lib/auto-save-controller');

const requiredDocuments = ['README.md', 'CHANGELOG.md', 'docs/publishing.md'];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function parseMarkdownTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith('|') || !lines[index + 1].trim().startsWith('|')) continue;
    const headers = splitTableRow(lines[index]);
    const separators = splitTableRow(lines[index + 1]);
    if (
      headers.length !== separators.length ||
      !separators.every(cell => /^:?-{3,}:?$/.test(cell))
    ) continue;

    const rows = [];
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      const cells = splitTableRow(lines[index]);
      if (cells.length === headers.length) {
        rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]])));
      }
      index += 1;
    }
    tables.push({ headers, rows });
    index -= 1;
  }

  return tables;
}

function submissionFields(markdown) {
  const table = parseMarkdownTables(markdown).find(candidate => (
    candidate.headers.length === 2 &&
    candidate.headers.includes('字段') &&
    candidate.headers.includes('拟提交内容')
  ));
  assert.ok(table, 'docs/publishing.md must contain a 字段/拟提交内容 submission table');
  return new Map(table.rows.map(row => [row['字段'], row['拟提交内容']]));
}

function publicationStatuses(markdown) {
  const table = parseMarkdownTables(markdown).find(candidate => (
    candidate.headers.length === 3 &&
    candidate.headers.includes('事项') &&
    candidate.headers.includes('状态') &&
    candidate.headers.includes('说明')
  ));
  assert.ok(table, 'docs/publishing.md must contain an 事项/状态/说明 publication-status table');
  return new Map(table.rows.map(row => [row['事项'], row['状态']]));
}

function jsonCodeBlocks(markdown) {
  return [...markdown.matchAll(/```json\s*([\s\S]*?)```/gi)].map(match => JSON.parse(match[1]));
}

function documentedDelayRange(text) {
  const match = text.match(/(?:ms|毫秒)[^\d]{0,12}(\d+)\s*[–—-]\s*(\d+)|(\d+)\s*[–—-]\s*(\d+)[^\d]{0,12}(?:ms|毫秒)/i);
  assert.ok(match, 'a numeric delay range with a unit must be documented');
  return (match[1] ? match.slice(1, 3) : match.slice(3, 5)).map(Number);
}

function markdownLinkTargets(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
}

function linkTarget(markdown) {
  const [target] = markdownLinkTargets(markdown);
  assert.ok(target, `expected a Markdown link, received: ${markdown}`);
  return target;
}

function changelogRelease(markdown) {
  const match = markdown.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m);
  assert.ok(match, 'CHANGELOG must contain a versioned release heading with an ISO date');
  return { version: match[1], date: match[2] };
}

function marketplaceRelease(value) {
  const match = value.match(/^(\d+\.\d+\.\d+)（(\d{4}-\d{2}-\d{2})）/);
  assert.ok(match, 'marketplace changelog must begin with a version and ISO date');
  return { version: match[1], date: match[2] };
}

test('required release documents exist and are non-empty', () => {
  for (const file of requiredDocuments) {
    const absolutePath = path.join(root, file);
    assert.ok(fs.existsSync(absolutePath), `${file} is required`);
    assert.ok(fs.statSync(absolutePath).size > 0, `${file} must not be empty`);
  }
});

test('README configuration example stays synchronized with the manifest defaults', () => {
  const properties = manifest.contributes.configuration.properties;
  const configurationKeys = Object.keys(properties).sort();
  const example = jsonCodeBlocks(read('README.md')).find(candidate => (
    candidate && typeof candidate === 'object' &&
    configurationKeys.every(key => Object.hasOwn(candidate, key))
  ));

  assert.ok(example, 'README must contain a parseable JSON configuration example');
  assert.deepEqual(Object.keys(example).sort(), configurationKeys);
  for (const key of configurationKeys) assert.equal(example[key], properties[key].default);
});

test('README and manifest delay bounds stay synchronized with runtime validation', () => {
  const manifestDelay = manifest.contributes.configuration.properties['hbuilderx-auto-save.delay'];
  assert.deepEqual(documentedDelayRange(manifestDelay.description), [MIN_DELAY, MAX_DELAY]);
  assert.deepEqual(documentedDelayRange(read('README.md')), [MIN_DELAY, MAX_DELAY]);
});

test('marketplace table retains every required submission field', () => {
  const fields = submissionFields(read('docs/publishing.md'));
  const requiredFields = [
    '插件名称', '插件 ID', '作者/发布者', '版本', '分类', '关键词/标签', '短描述',
    '详细介绍', '使用说明', '更新日志', '价格', '开源协议', '隐私声明', '权限声明',
    '数据声明', '广告声明', '平台', '最低 HBuilderX', '已验证环境', '源码地址',
    '问题反馈', '发行 ZIP', '截图建议', '审核备注', '个人/学生发布说明', '发布状态'
  ];

  for (const field of requiredFields) {
    assert.ok(fields.has(field), `missing marketplace field: ${field}`);
    assert.ok(fields.get(field).trim(), `marketplace field must not be empty: ${field}`);
  }
});

test('marketplace pricing, licensing, portal checks, and unfinished work have structured statuses', () => {
  const publishing = read('docs/publishing.md');
  const fields = submissionFields(publishing);
  const statuses = publicationStatuses(publishing);
  const allowedStatuses = new Set(['已证实', '门户当天复核', '尚未完成']);

  for (const status of statuses.values()) assert.ok(allowedStatuses.has(status), `unknown publication status: ${status}`);
  assert.deepEqual(new Set(statuses.values()), allowedStatuses);
  assert.equal(fields.get('价格'), '免费（平台产品类型规则）');
  assert.equal(fields.get('开源协议'), manifest.license);
  assert.equal(statuses.get('市场价格'), '已证实');
  assert.equal(statuses.get('开源许可证'), '已证实');
  assert.equal(statuses.get('个人身份与门户字段'), '门户当天复核');
  assert.equal(statuses.get('插件 ID 唯一性'), '尚未完成');
});

test('manifest-backed marketplace values stay synchronized', () => {
  const fields = submissionFields(read('docs/publishing.md'));
  const expected = new Map([
    ['插件名称', manifest.displayName],
    ['插件 ID', manifest.id],
    ['作者/发布者', manifest.publisher],
    ['版本', manifest.version],
    ['分类', manifest.dcloudext.category[0]],
    ['开源协议', manifest.license],
    ['最低 HBuilderX', `${manifest.engines.HBuilderX.replace(/^\^/, '')}+`]
  ]);

  for (const [field, value] of expected) assert.equal(fields.get(field), value);
  assert.deepEqual(fields.get('关键词/标签').split('、'), manifest.keywords);
  assert.equal(linkTarget(fields.get('源码地址')), manifest.repository);
  assert.equal(linkTarget(fields.get('问题反馈')), manifest.bugs);
  assert.equal(fields.get('短描述'), manifest.description);
  assert.ok([...fields.get('短描述')].length <= 30, 'marketplace short description must be at most 30 characters');
  assert.equal(fields.get('发行 ZIP'), `${manifest.id}.zip`);
  assert.deepEqual(marketplaceRelease(fields.get('更新日志')), changelogRelease(read('CHANGELOG.md')));
});

test('marketplace declarations stay synchronized with the manifest', () => {
  const fields = submissionFields(read('docs/publishing.md'));
  const declaration = manifest.dcloudext.declaration;
  assert.equal(fields.get('权限声明'), declaration.permissions);
  assert.equal(fields.get('数据声明'), declaration.data);
  assert.equal(fields.get('广告声明'), declaration.ads);
});

test('documentation Markdown links use valid HTTPS URLs', () => {
  for (const file of ['README.md', 'docs/publishing.md']) {
    const targets = markdownLinkTargets(read(file));
    assert.ok(targets.length > 0, `${file} must contain at least one link`);
    for (const target of targets) {
      const url = new URL(target);
      assert.equal(url.protocol, 'https:', `${file} link must use HTTPS: ${target}`);
    }
  }
});

test('CHANGELOG initial release matches the manifest version and uses a valid ISO date', () => {
  const release = changelogRelease(read('CHANGELOG.md'));
  assert.equal(release.version, manifest.version);
  assert.equal(new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10), release.date);
});
