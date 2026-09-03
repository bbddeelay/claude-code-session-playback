'use strict';

const fs = require('fs');
const path = require('path');

const MAX_DEPTH = 3;

/**
 * dir 以下から .jsonl ファイルを探す。
 * dir 直下に見つかればそれを優先し、無ければ数階層下まで再帰的に探す
 * (~/.claude/projects/<project>/*.jsonl のような構成に対応するため)。
 */
function findJsonlFiles(rootDir, limit = 10) {
  const direct = listJsonlInDir(rootDir);
  const files = direct.length > 0 ? direct : walk(rootDir, MAX_DEPTH);

  const withStats = files.map((filePath) => {
    const stat = fs.statSync(filePath);
    return { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
  });

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return withStats.slice(0, limit);
}

function listJsonlInDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`ディレクトリを読み込めなかったよ: ${dir} (${err.message})`);
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => path.join(dir, e.name));
}

function walk(dir, depth) {
  if (depth < 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  let results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full, depth - 1));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

module.exports = { findJsonlFiles };
