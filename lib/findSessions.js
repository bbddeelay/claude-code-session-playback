'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_DEPTH = 3;
const PROJECT_KEY_MAX = 200; // Claude Code 側のスラッグ長の上限

/**
 * Claude Code の設定ディレクトリ (既定は ~/.claude)。
 */
function configHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function projectsRoot() {
  return path.join(configHome(), 'projects');
}

/**
 * プロジェクトの作業ディレクトリ -> Claude Code が使うディレクトリ名。
 * 本体と同じく英数字以外をハイフンに置き換える。
 * (200文字を超えるときは本体側でハッシュが付くが、それは再現できないので
 *  呼び出し側で前方一致で探す)
 */
function projectKey(dir) {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listJsonlInDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
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
      // サブエージェントの記録は単体で再生しても会話にならないので辿らない
      if (entry.name === 'subagents') continue;
      results = results.concat(walk(full, depth - 1));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * projects 配下から、cwd に対応するプロジェクトディレクトリを探す。
 */
function projectDirFor(dir) {
  const root = projectsRoot();
  const key = projectKey(dir);

  const exact = path.join(root, key);
  if (isDir(exact)) return exact;

  // 長いパスは本体側で "先頭200文字 + ハッシュ" になるので前方一致で拾う
  if (key.length > PROJECT_KEY_MAX) {
    const prefix = key.slice(0, PROJECT_KEY_MAX);
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return null;
    }
    const hit = entries.find((e) => e.isDirectory() && e.name.startsWith(prefix));
    if (hit) return path.join(root, hit.name);
  }

  return null;
}

/**
 * projects 配下の全プロジェクトからセッションを集める。
 */
function allProjectSessions(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  let files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    files = files.concat(listJsonlInDir(path.join(root, entry.name)));
  }
  return files;
}

/**
 * 渡されたディレクトリからセッションの jsonl を探す。
 *
 * 1. そのディレクトリ直下に jsonl がある            -> それを使う
 * 2. <configHome>/projects/<スラッグ> がある        -> そこを使う
 * 3. 渡されたのが <configHome>/projects 自体        -> 全プロジェクト横断
 * 4. どれでもなければディレクトリ配下を再帰探索
 *
 * 戻り値: { files: [{ filePath, mtimeMs, size }], sourceDir, mode }
 *   mode: 'direct' | 'project' | 'all-projects' | 'recursive'
 */
function findSessions(inputDir, limit = 10) {
  const root = projectsRoot();
  let files = [];
  let sourceDir = inputDir;
  let mode = 'direct';

  const direct = listJsonlInDir(inputDir);
  if (direct.length > 0) {
    files = direct;
  } else if (path.resolve(inputDir) === path.resolve(root)) {
    files = allProjectSessions(root);
    sourceDir = root;
    mode = 'all-projects';
  } else {
    const projectDir = projectDirFor(inputDir);
    if (projectDir) {
      files = listJsonlInDir(projectDir);
      sourceDir = projectDir;
      mode = 'project';
    } else {
      files = walk(inputDir, MAX_DEPTH);
      mode = 'recursive';
    }
  }

  const withStats = [];
  for (const filePath of files) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    withStats.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
  }

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return { files: withStats.slice(0, limit), sourceDir, mode };
}

module.exports = { findSessions, projectKey, projectsRoot, configHome };
