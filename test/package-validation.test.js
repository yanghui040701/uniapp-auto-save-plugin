const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateDistribution } = require('../scripts/validate-package');

const EXPECTED_FILES = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'extension.js',
  'lib/auto-save-controller.js',
  'lib/focus-save-coordinator.js',
  'lib/hbuilderx-runtime.js',
  'lib/prompt-state.js',
  'package.json'
];

const VALID_MANIFEST = {
  id: 'yanghui-auto-save',
  version: '1.0.0',
  dependencies: {}
};

function createDistributionFixture(t, manifest = VALID_MANIFEST) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-package-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const file of EXPECTED_FILES) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(
      destination,
      file === 'package.json' ? JSON.stringify(manifest) : `fixture for ${file}\n`
    );
  }

  return root;
}

function createPackagingFixture(t, testScript = 'node -e "process.exit(0)"') {
  const root = createDistributionFixture(t, {
    id: 'yanghui-auto-save',
    name: 'Packaging fixture',
    version: '1.0.0',
    scripts: {
      test: testScript,
      validate: 'node scripts/validate-package.js'
    },
    dependencies: {}
  });
  const repositoryRoot = path.resolve(__dirname, '..');
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(scriptsDir);
  fs.copyFileSync(
    path.join(repositoryRoot, 'scripts', 'validate-package.js'),
    path.join(scriptsDir, 'validate-package.js')
  );
  const packageScript = path.join(repositoryRoot, 'scripts', 'package.ps1');
  if (fs.existsSync(packageScript)) {
    fs.copyFileSync(packageScript, path.join(scriptsDir, 'package.ps1'));
  }
  return root;
}

function runPackageScript(root) {
  return childProcess.spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'scripts', 'package.ps1')
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 }
  );
}

function readZipEntries(zipPath) {
  const escapedPath = zipPath.replaceAll("'", "''");
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedPath}')`,
    "try { $zip.Entries | ForEach-Object { $_.FullName.Replace('\\', '/') } } finally { $zip.Dispose() }"
  ].join('; ');
  const result = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 30_000
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function seedOldArtifacts(root) {
  const stagingMarker = path.join(root, 'dist', 'yanghui-auto-save', 'keep.txt');
  fs.mkdirSync(path.dirname(stagingMarker), { recursive: true });
  fs.writeFileSync(stagingMarker, 'staging');
  const zipMarker = path.join(root, 'dist', 'yanghui-auto-save.zip');
  fs.writeFileSync(zipMarker, 'zip');
  return { stagingMarker, zipMarker };
}

function assertOldArtifactsUnchanged(markers) {
  assert.equal(fs.readFileSync(markers.stagingMarker, 'utf8'), 'staging');
  assert.equal(fs.readFileSync(markers.zipMarker, 'utf8'), 'zip');
}

function writeConditionalValidator(root, filesJsonBranch) {
  fs.writeFileSync(
    path.join(root, 'scripts', 'validate-package.js'),
    [
      "if (process.argv.includes('--files-json')) {",
      `  ${filesJsonBranch}`,
      '  return;',
      '}',
      "console.log('validation passed');"
    ].join('\n')
  );
}

test('repository contains every required distribution file', () => {
  const result = validateDistribution(path.resolve(__dirname, '..'));

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.files.toSorted(), EXPECTED_FILES);
});

test('distribution allowlist excludes development and sensitive paths', () => {
  const { files } = validateDistribution(path.resolve(__dirname, '..'));

  assert.equal(files.length, 9);
  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)(\.git|node_modules|test|docs|dist)(\/|$)/);
    assert.notEqual(file, '.auto-save-state.json');
  }
});

test('missing package.json is reported without throwing', (t) => {
  const root = createDistributionFixture(t);
  fs.rmSync(path.join(root, 'package.json'));

  const result = validateDistribution(root);

  assert.match(result.errors.join('\n'), /package\.json/);
});

test('invalid package.json JSON is reported without throwing', (t) => {
  const root = createDistributionFixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"id":');

  const result = validateDistribution(root);

  assert.match(result.errors.join('\n'), /JSON/);
});

test('non-object package.json values are reported without throwing', async (t) => {
  for (const [name, source] of [
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"yanghui-auto-save"']
  ]) {
    await t.test(name, (t) => {
      const root = createDistributionFixture(t);
      fs.writeFileSync(path.join(root, 'package.json'), source);

      const result = validateDistribution(root);

      assert.match(result.errors.join('\n'), /JSON 根值必须是对象/);
    });
  }
});

test('malformed and populated runtime dependency fields are rejected', async (t) => {
  const cases = [
    ['dependencies has the wrong type', { dependencies: null }, /dependencies 必须是对象/],
    ['dependencies is populated', { dependencies: { lodash: '4.17.21' } }, /dependencies 必须为空/],
    ['optionalDependencies is populated', { optionalDependencies: { fsevents: '2.3.3' } }, /optionalDependencies 必须为空/],
    ['peerDependencies is populated', { peerDependencies: { hbuilderx: '1.0.0' } }, /peerDependencies 必须为空/],
    ['bundledDependencies is populated', { bundledDependencies: ['lodash'] }, /bundledDependencies 必须为空/]
  ];

  for (const [name, dependencyFields, expectedError] of cases) {
    await t.test(name, (t) => {
      const root = createDistributionFixture(t, {
        id: 'yanghui-auto-save',
        version: '1.0.0',
        ...dependencyFields
      });

      const result = validateDistribution(root);

      assert.match(result.errors.join('\n'), expectedError);
    });
  }
});

test('required distribution paths must be ordinary files', (t) => {
  const root = createDistributionFixture(t);
  fs.rmSync(path.join(root, 'extension.js'));
  fs.mkdirSync(path.join(root, 'extension.js'));

  const result = validateDistribution(root);

  assert.match(result.errors.join('\n'), /不是普通文件: extension\.js/);
});

test('distribution paths reject lib junctions before following their files', async (t) => {
  for (const targetKind of ['outside root', 'inside root']) {
    await t.test(targetKind, (t) => {
      const root = createDistributionFixture(t);
      const target = targetKind === 'outside root'
        ? fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-lib-junction-'))
        : path.join(root, 'internal-lib');
      if (targetKind === 'outside root') {
        t.after(() => fs.rmSync(target, { recursive: true, force: true }));
      } else {
        fs.mkdirSync(target);
      }
      for (const file of EXPECTED_FILES.filter((file) => file.startsWith('lib/'))) {
        fs.writeFileSync(path.join(target, path.basename(file)), `junction fixture for ${file}\n`);
      }
      fs.rmSync(path.join(root, 'lib'), { recursive: true });
      fs.symlinkSync(target, path.join(root, 'lib'), 'junction');

      const result = validateDistribution(root);

      assert.match(result.errors.join('\n'), /重解析点|仓库外/);
    });
  }
});

test('invalid validation roots return errors instead of escaping exceptions', () => {
  for (const root of [null, {}, Symbol('hostile-root')]) {
    const result = validateDistribution(root);
    assert.deepEqual(result.files.toSorted(), EXPECTED_FILES);
    assert.match(result.errors.join('\n'), /发布根目录无效/);
  }
});

test('package script creates only the nine allowlisted files under one archive root', (t) => {
  const root = createPackagingFixture(t);
  for (const unwanted of [
    'test/private.test.js',
    'docs/internal.md',
    'node_modules/private/index.js',
    '.git/config',
    '.auto-save-state.json',
    'scratch.tmp'
  ]) {
    const destination = path.join(root, unwanted);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'must not ship');
  }

  const result = runPackageScript(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const stagingRoot = path.join(root, 'dist', 'yanghui-auto-save');
  assert.equal(fs.statSync(stagingRoot).isDirectory(), true);
  const zipPath = path.join(root, 'dist', 'yanghui-auto-save.zip');
  const entries = readZipEntries(zipPath).map((entry) => entry.replaceAll('\\', '/'));
  const fileEntries = entries.filter((entry) => !entry.endsWith('/'));
  assert.deepEqual(
    fileEntries.toSorted(),
    EXPECTED_FILES.map((file) => `yanghui-auto-save/${file}`).toSorted()
  );
  assert.deepEqual([...new Set(fileEntries.map((entry) => entry.split('/')[0]))], [
    'yanghui-auto-save'
  ]);
});

test('package script rejects a dist junction before deleting outside files', (t) => {
  const root = createPackagingFixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yanghui-package-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(outside, 'yanghui-auto-save'));
  const marker = path.join(outside, 'yanghui-auto-save', 'keep.txt');
  fs.writeFileSync(marker, 'keep');
  fs.symlinkSync(outside, path.join(root, 'dist'), 'junction');

  const result = runPackageScript(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /PACKAGE_SAFETY_ERROR/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
});

test('package script stops before cleanup when npm test fails', (t) => {
  const root = createPackagingFixture(t, 'node -e "process.exit(23)"');
  const markers = seedOldArtifacts(root);

  const result = runPackageScript(root);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /PACKAGE_TEST_FAILED/);
  assertOldArtifactsUnchanged(markers);
});

test('every allowlist preflight failure preserves old staging and ZIP artifacts', async (t) => {
  const allowlistJson = JSON.stringify(EXPECTED_FILES);
  const cases = [
    ['allowlist query exits nonzero', 'process.exit(17)'],
    ['allowlist query emits malformed JSON', "process.stdout.write('not json')"],
    ['allowlist query emits the wrong count', "process.stdout.write('[\"package.json\"]')"],
    [
      'allowlist query emits a traversal path',
      `process.stdout.write(${JSON.stringify(JSON.stringify([
        ...EXPECTED_FILES.slice(0, 8),
        '../outside.txt'
      ]))})`
    ],
    ['allowlisted source is missing', `process.stdout.write(${JSON.stringify(allowlistJson)})`]
  ];

  for (const [name, filesJsonBranch] of cases) {
    await t.test(name, (t) => {
      const root = createPackagingFixture(t);
      writeConditionalValidator(root, filesJsonBranch);
      if (name === 'allowlisted source is missing') {
        fs.rmSync(path.join(root, 'extension.js'));
      }
      const markers = seedOldArtifacts(root);

      const result = runPackageScript(root);

      assert.notEqual(result.status, 0);
      assertOldArtifactsUnchanged(markers);
    });
  }
});
