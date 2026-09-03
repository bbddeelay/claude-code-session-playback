#!/usr/bin/env node
'use strict';

const path = require('path');
const os = require('os');
const { findJsonlFiles } = require('../lib/findSessions');
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

async function main() {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => !a.startsWith('-'));

  if (!dirArg) {
    console.error('使い方: ccplayback <ディレクトリ>');
    console.error('例:     ccplayback ~/.claude/projects/-home-user-myproject');
    process.exit(1);
  }

  const dir = path.resolve(expandHome(dirArg));

  let sessionFiles;
  try {
    sessionFiles = findJsonlFiles(dir, 10);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (sessionFiles.length === 0) {
    console.error(`jsonl ファイルが見つからなかったよ: ${dir}`);
    process.exit(1);
  }

  const chosen = await pickSession(sessionFiles);

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
