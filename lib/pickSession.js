'use strict';

const readline = require('readline');
const path = require('path');
const { readSessionMeta } = require('./parseSession');

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

async function pickSession(sessionFiles) {
  const metas = await Promise.all(
    sessionFiles.map(async (f) => {
      try {
        const meta = await readSessionMeta(f.filePath);
        return { ...f, meta };
      } catch {
        return { ...f, meta: {} };
      }
    })
  );

  console.log('');
  console.log('セッションを選んでね (最新順)');
  console.log('');

  metas.forEach((m, i) => {
    const snippet = (m.meta.firstUser || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  [${i + 1}] ${path.basename(m.filePath)}`);
    console.log(`      更新: ${formatDate(m.meta.lastTimestamp)}  発言数: ${m.meta.userTurns || 0}`);
    if (snippet) console.log(`      "${snippet}${snippet.length >= 60 ? '...' : ''}"`);
    console.log('');
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`番号を入力してね (1-${metas.length}): `, resolve);
  });
  rl.close();

  const idx = parseInt(answer, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= metas.length) {
    throw new Error('番号がおかしいみたい。もう一回試してみて。');
  }

  return metas[idx];
}

module.exports = { pickSession };
