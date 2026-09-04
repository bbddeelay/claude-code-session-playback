'use strict';

const fs = require('fs');
const readline = require('readline');

/**
 * jsonl ファイルを読み込み、プレイバック用の「ステップ」の配列に変換する。
 *
 * ステップの種類:
 *  - user      : ユーザーの発言(プロンプト)
 *  - thinking  : Claude の思考ブロック
 *  - text      : Claude の応答テキスト
 *  - tool      : ツール呼び出し(結果があれば result にひもづく)
 */
async function parseSessionFile(filePath) {
  const rawLines = await readLines(filePath);

  const records = [];
  for (const line of rawLines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === 'user' || obj.type === 'assistant') {
      records.push(obj);
    }
  }

  // 同じ message.id を持つ連続した assistant レコードを1つのメッセージにまとめる
  // (1つのAPI応答が複数のjsonl行に分割されて記録されているケースに対応)
  const merged = [];
  for (const rec of records) {
    if (rec.type === 'assistant') {
      const last = merged[merged.length - 1];
      const msgId = rec.message && rec.message.id;
      if (
        last &&
        last.type === 'assistant' &&
        last.message &&
        last.message.id === msgId &&
        msgId !== undefined
      ) {
        last.blocks.push(...toBlockArray(rec.message.content));
        last._lastTimestamp = rec.timestamp;
        continue;
      }
      merged.push({
        type: 'assistant',
        timestamp: rec.timestamp,
        message: rec.message,
        blocks: toBlockArray(rec.message.content),
      });
    } else {
      merged.push(rec);
    }
  }

  const steps = [];
  const toolStepById = new Map();

  for (const rec of merged) {
    if (rec.type === 'user') {
      const content = rec.message && rec.message.content;
      const toolResults = extractToolResults(content);
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const toolStep = toolStepById.get(tr.tool_use_id);
          if (toolStep) {
            toolStep.result = tr.text;
            toolStep.resultIsError = !!tr.is_error;
          }
        }
        continue;
      }

      const text = extractUserText(content);
      if (text) {
        steps.push({
          role: 'user',
          kind: 'user',
          text,
          timestamp: rec.timestamp,
        });
      }
      continue;
    }

    // assistant
    for (const block of rec.blocks) {
      if (block.type === 'thinking') {
        const text = (block.thinking || '').trim();
        if (text) {
          steps.push({
            role: 'assistant',
            kind: 'thinking',
            text,
            timestamp: rec.timestamp,
          });
        }
      } else if (block.type === 'text') {
        const text = (block.text || '').trim();
        if (text) {
          steps.push({
            role: 'assistant',
            kind: 'text',
            text,
            timestamp: rec.timestamp,
          });
        }
      } else if (block.type === 'tool_use') {
        const step = {
          role: 'assistant',
          kind: 'tool',
          toolName: block.name,
          input: block.input,
          result: null,
          resultIsError: false,
          timestamp: rec.timestamp,
        };
        steps.push(step);
        if (block.id) toolStepById.set(block.id, step);
      }
    }
  }

  return steps;
}

function toBlockArray(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

function extractUserText(content) {
  if (typeof content === 'string') return normalizeUserText(content);
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        parts.push(block.text);
      } else if (block.type === 'image') {
        parts.push('[画像添付]');
      }
    }
    return normalizeUserText(parts.join('\n\n'));
  }
  return '';
}

/**
 * 発言に混ざる制御用のタグを、再生に適した形に整える。
 *  - スラッシュコマンドの記録 -> "/clear" のような表記に
 *  - 注意書きやシステムリマインダ -> 会話ではないので落とす
 */
function normalizeUserText(raw) {
  if (!raw) return '';
  let text = raw;

  const commandName = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (commandName) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
    const name = commandName[1].trim();
    const argText = args ? args[1].trim() : '';
    return argText ? `${name} ${argText}` : name;
  }

  text = text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');

  return text.trim();
}

function extractToolResults(content) {
  if (!Array.isArray(content)) return [];
  const results = [];
  for (const block of content) {
    if (block.type === 'tool_result') {
      results.push({
        tool_use_id: block.tool_use_id,
        is_error: block.is_error,
        text: toolResultText(block.content),
      });
    }
  }
  return results;
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && c.type === 'text') return c.text;
        if (c && c.type === 'image') return '[画像]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function readLines(filePath) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => lines.push(line));
    rl.on('close', () => resolve(lines));
    rl.on('error', reject);
  });
}

/**
 * セッションファイルのメタ情報 (先頭の user レコードなどから抽出)。
 */
async function readSessionMeta(filePath) {
  const rawLines = await readLines(filePath);
  let firstUser = null;
  let firstCommand = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;
  let gitBranch = null;
  let version = null;
  let userTurns = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  const assistantMessageIds = new Set();

  for (const line of rawLines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    if (obj.timestamp) {
      if (!firstTimestamp) firstTimestamp = obj.timestamp;
      lastTimestamp = obj.timestamp;
    }
    if (obj.type === 'user') {
      cwd = cwd || obj.cwd;
      gitBranch = gitBranch || obj.gitBranch;
      version = version || obj.version;
      const content = obj.message && obj.message.content;
      const isRealPrompt =
        typeof content === 'string' ||
        (Array.isArray(content) && content.every((b) => b.type !== 'tool_result'));
      const text = isRealPrompt ? extractUserText(content) : '';
      if (text) {
        userTurns += 1;
        // 一覧の見出しには、スラッシュコマンドより中身のある発言を優先する
        if (!firstUser && !text.startsWith('/')) firstUser = text;
        if (!firstCommand) firstCommand = text;
      }
    } else {
      const message = obj.message || {};
      // 1つの応答が複数行に分割されて記録されるので message.id で数える
      if (message.id && !assistantMessageIds.has(message.id)) {
        assistantMessageIds.add(message.id);
        assistantTurns += 1;
      }
      for (const block of toBlockArray(message.content)) {
        if (block.type === 'tool_use') toolCalls += 1;
      }
    }
  }

  return {
    firstUser: firstUser || firstCommand,
    firstTimestamp,
    lastTimestamp,
    cwd,
    gitBranch,
    version,
    userTurns,
    assistantTurns,
    toolCalls,
  };
}

module.exports = { parseSessionFile, readSessionMeta };
