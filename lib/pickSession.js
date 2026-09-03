'use strict';

const os = require('os');
const path = require('path');
const readline = require('readline');
const { readSessionMeta } = require('./parseSession');

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * 「3時間前」「昨日 14:20」のような相対表記。
 */
function relativeTime(iso) {
  if (!iso) return '日時不明';
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);

  if (diffMin < 1) return 'いま';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `昨日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * セッションの所要時間 (最初〜最後のやりとり)。
 */
function duration(from, to) {
  if (!from || !to) return null;
  const min = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  if (min < 1) return '1分未満';
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

function shortenHome(p) {
  if (!p) return '';
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/**
 * 端末幅に合わせて1行に収める (全角を2幅として数える)。
 */
function fitWidth(text, max) {
  const width = (s) => [...s].reduce((w, ch) => w + (/[\x00-\x7F｡-ﾟ]/.test(ch) ? 1 : 2), 0);
  if (width(text) <= max) return text;
  let out = '';
  for (const ch of text) {
    if (width(out + ch) > max - 1) break;
    out += ch;
  }
  return out + '…';
}

async function pickSession(sessionFiles, { showProject = false } = {}) {
  const metas = await Promise.all(
    sessionFiles.map(async (f) => {
      try {
        return { ...f, meta: await readSessionMeta(f.filePath) };
      } catch {
        return { ...f, meta: {} };
      }
    })
  );

  const termWidth = process.stdout.columns || 100;
  const snippetWidth = Math.max(40, Math.min(termWidth - 10, 110));

  console.log('');
  console.log(`セッションを選んでね (新しい順に ${metas.length} 件)`);
  console.log('');

  metas.forEach((m, i) => {
    const meta = m.meta || {};
    const sessionId = path.basename(m.filePath, '.jsonl').slice(0, 8);

    const stats = [];
    if (meta.userTurns) stats.push(`会話 ${meta.userTurns}往復`);
    if (meta.toolCalls) stats.push(`ツール ${meta.toolCalls}回`);
    const span = duration(meta.firstTimestamp, meta.lastTimestamp);
    if (span) stats.push(span);

    const num = `[${String(i + 1).padStart(2, ' ')}]`;
    console.log(`  ${num} ${relativeTime(meta.lastTimestamp)}   ${stats.join(' / ')}`);

    const snippet = (meta.firstUser || '(発言なし)').replace(/\s+/g, ' ');
    console.log(`       ${fitWidth(snippet, snippetWidth)}`);

    const where = showProject ? `  ${shortenHome(meta.cwd || '')}` : '';
    console.log(`       ${sessionId}${where}`);
    console.log('');
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`番号を入力してね (1-${metas.length}, そのまま Enter で 1): `, resolve);
  });
  rl.close();

  const trimmed = answer.trim();
  const idx = trimmed === '' ? 0 : parseInt(trimmed, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= metas.length) {
    throw new Error('番号がおかしいみたい。もう一回試してみて。');
  }

  return metas[idx];
}

module.exports = { pickSession };
