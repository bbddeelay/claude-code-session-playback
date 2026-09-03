#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const { findSessions, projectKey, projectsRoot } = require('../lib/findSessions');
const { pickSession } = require('../lib/pickSession');
const { parseSessionFile, readSessionMeta } = require('../lib/parseSession');
const { startServer } = require('../lib/server');
const { openBrowser } = require('../lib/openBrowser');

function expandHome(p) {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function usage() {
  console.error('使い方: ccplayback [ディレクトリ]');
  console.error('');
  console.error('  ccplayback                      カレントのプロジェクトのセッション');
  console.error('  ccplayback ~/myproject          そのプロジェクトのセッション');
  console.error('  ccplayback ~/.claude/projects   全プロジェクトのセッション');
}

function notFoundMessage(dir) {
  const lines = [
    `セッションの jsonl が見つからんかったよ: ${dir}`,
    '',
    'Claude Code のセッションはプロジェクトの中じゃなくて、こっちに保存されとるよ:',
    `  ${path.join(projectsRoot(), projectKey(dir))}`,
    '',
    `${path.join(projectsRoot())} を直接渡すと、全プロジェクトから選べるよ。`,
  ];
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(0);
  }

  const dirArg = args.find((a) => !a.startsWith('-'));
  const dir = path.resolve(dirArg ? expandHome(dirArg) : process.cwd());

  const { files, sourceDir, mode } = findSessions(dir, 10);

  if (files.length === 0) {
    console.error(notFoundMessage(dir));
    process.exit(1);
  }

  if (mode === 'project') {
    console.log(`${dir} のセッションを ${sourceDir} から読むよ`);
  } else if (mode === 'all-projects') {
    console.log('全プロジェクトのセッションを新しい順に並べるよ');
  }

  const chosen = await pickSession(files, { showProject: mode !== 'project' });

  console.log('');
  console.log(`"${path.basename(chosen.filePath)}" を読み込み中...`);

  const steps = await parseSessionFile(chosen.filePath);
  const meta = await readSessionMeta(chosen.filePath);

  if (steps.length === 0) {
    console.error('このセッションには表示できるやりとりが無かったよ。');
    process.exit(1);
  }

  const { url } = await startServer({
    steps,
    meta,
    sessionName: path.basename(chosen.filePath),
  });

  console.log(`準備できた! ブラウザで開くよ -> ${url}`);
  console.log('終わるときは Ctrl+C で止めてね。');

  openBrowser(url);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
