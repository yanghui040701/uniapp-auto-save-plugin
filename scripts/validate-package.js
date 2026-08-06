'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DISTRIBUTION_FILES = [
  'package.json',
  'extension.js',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'lib/auto-save-controller.js',
  'lib/hbuilderx-runtime.js',
  'lib/focus-save-coordinator.js',
  'lib/prompt-state.js'
];

function validateDistribution(root) {
  const files = [...DISTRIBUTION_FILES];
  const errors = [];
  let resolvedRoot;

  try {
    if (typeof root !== 'string' || root.length === 0) {
      throw new TypeError('root must be a non-empty string');
    }
    resolvedRoot = path.resolve(root);
    const rootStat = fs.lstatSync(resolvedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new TypeError('root must be an ordinary directory');
    }
  } catch {
    errors.push('发布根目录无效');
    return { files, errors };
  }

  let packageJsonIsFile = false;
  for (const file of files) {
    try {
      const stat = fs.lstatSync(path.join(resolvedRoot, file));
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push(`发布路径不是普通文件: ${file}`);
      } else if (file === 'package.json') {
        packageJsonIsFile = true;
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        errors.push(`缺少发布文件: ${file}`);
      } else {
        errors.push(`无法检查发布文件: ${file}`);
      }
    }
  }

  if (!packageJsonIsFile) return { files, errors };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'package.json'), 'utf8'));
  } catch {
    errors.push('package.json 不是有效的 JSON');
    return { files, errors };
  }

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push('package.json 的 JSON 根值必须是对象');
    return { files, errors };
  }

  if (manifest.id !== 'yanghui-auto-save') errors.push('插件 ID 不正确');
  if (manifest.version !== '1.0.0') errors.push('插件版本不是 1.0.0');

  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!Object.hasOwn(manifest, field)) continue;
    const dependencies = manifest[field];
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      errors.push(`${field} 必须是对象`);
    } else if (Object.keys(dependencies).length > 0) {
      errors.push(`${field} 必须为空`);
    }
  }

  for (const field of ['bundledDependencies', 'bundleDependencies']) {
    if (!Object.hasOwn(manifest, field)) continue;
    const dependencies = manifest[field];
    if (!Array.isArray(dependencies)) {
      errors.push(`${field} 必须是数组`);
    } else if (dependencies.length > 0) {
      errors.push(`${field} 必须为空`);
    }
  }

  return { files, errors };
}

if (require.main === module) {
  const result = validateDistribution(path.resolve(__dirname, '..'));
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else if (process.argv.includes('--files-json')) {
    process.stdout.write(JSON.stringify(result.files));
  } else {
    console.log(`已验证 ${result.files.length} 个发布文件。`);
  }
}

module.exports = { validateDistribution };
