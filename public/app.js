(() => {
  'use strict';

  const transcriptEl = document.getElementById('transcript');
  const scrollAnchor = document.getElementById('scrollAnchor');
  const stageEl = document.querySelector('.stage');
  const sessionMetaEl = document.getElementById('sessionMeta');
  const btnNext = document.getElementById('btnNext');
  const btnBack = document.getElementById('btnBack');
  const btnRestart = document.getElementById('btnRestart');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const speedSelect = document.getElementById('speedSelect');

  let steps = [];
  let index = 0; // 表示済みステップ数 (0..steps.length)
  let animating = false;
  let skipRequested = false;
  let speed = 1; // 1 = 等速, 2 = 2倍速, 0 = 文字送りなし(即表示)

  const TOOL_INPUT_LIMIT = 600;
  const TOOL_RESULT_LIMIT = 700;

  const TOOL_ICONS = {
    Bash: '$',
    Read: '📄',
    Write: '✏️',
    Edit: '✂️',
    Grep: '🔍',
    Glob: '🔎',
    WebSearch: '🌐',
    WebFetch: '🌐',
    Task: '🤖',
  };

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ごく簡易な Markdown -> HTML (コードブロック / インラインコード / 太字 / 見出し / リスト)
  function renderMarkdown(src) {
    const lines = src.split('\n');
    let html = '';
    let inCode = false;
    let codeBuf = [];
    let inList = false;

    const flushList = () => {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
    };

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (!inCode) {
          inCode = true;
          codeBuf = [];
        } else {
          inCode = false;
          html += `<pre class="codeblock"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`;
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushList();
        const level = Math.min(heading[1].length + 2, 6);
        html += `<h${level}>${inline(heading[2])}</h${level}>`;
        continue;
      }

      const listItem = line.match(/^\s*[-*]\s+(.*)$/);
      if (listItem) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${inline(listItem[1])}</li>`;
        continue;
      }

      flushList();
      if (line.trim() === '') {
        html += '<br/>';
      } else {
        html += `<p>${inline(line)}</p>`;
      }
    }
    flushList();
    if (inCode && codeBuf.length) {
      html += `<pre class="codeblock"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`;
    }
    return html;
  }

  function inline(text) {
    let t = escapeHtml(text);
    t = t.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    return t;
  }

  // JSON.stringify だと改行が \n のまま出て読みにくいので、
  // "キー: 値" 形式(複数行の値はそのまま改行して)で整形する。
  function formatToolInput(step) {
    const input = step.input;
    if (input === null || input === undefined) return '';
    if (typeof input !== 'object') return String(input);

    if (step.toolName === 'Bash' && typeof input.command === 'string') {
      const rest = Object.keys(input).filter((k) => k !== 'command' && k !== 'description');
      const extra = rest.length ? '\n\n' + rest.map((k) => `${k}: ${stringifyValue(input[k])}`).join('\n') : '';
      return `$ ${input.command}${extra}`;
    }

    return Object.keys(input)
      .map((key) => {
        const value = stringifyValue(input[key]);
        return value.includes('\n') ? `${key}:\n${value}` : `${key}: ${value}`;
      })
      .join('\n');
  }

  function stringifyValue(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  function shorten(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max);
  }

  /**
   * 長すぎるテキストを短縮して表示し、「もっと見る」で全文に差し替える。
   * 短縮した場合のみボタンを bubble に追加する。
   */
  function attachExpander(bubble, bodyEl, fullText, max) {
    if (!fullText || fullText.length <= max) return;

    const btn = document.createElement('button');
    btn.className = 'expand-btn';
    btn.textContent = `▼ もっと見る (全 ${fullText.length} 文字)`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      bodyEl.textContent = fullText;
      btn.remove();
    });
    bubble.insertBefore(btn, bodyEl.nextSibling);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function typeInto(el, text, { min = 6, max = 22 } = {}) {
    if (speed === 0) {
      el.textContent = text;
      stageEl.scrollTop = stageEl.scrollHeight;
      return;
    }

    animating = true;
    skipRequested = false;
    updateProgress();
    el.textContent = '';
    const caret = document.createElement('span');
    caret.className = 'caret';
    el.appendChild(caret);

    for (let i = 0; i < text.length; i++) {
      if (skipRequested) {
        caret.insertAdjacentText('beforebegin', text.slice(i));
        break;
      }
      const ch = text[i];
      caret.insertAdjacentText('beforebegin', ch);
      let delay = min + Math.random() * (max - min);
      if (ch === '\n') delay += 60;
      else if ('.,。、!?!?'.includes(ch)) delay += 90;
      el.scrollTop = el.scrollHeight; // 箱の中でスクロールする要素 (ツール出力) 用
      stageEl.scrollTop = stageEl.scrollHeight;
      await sleep(delay / speed);
    }
    caret.remove();
    animating = false;
    updateProgress();
  }

  function requestSkip() {
    if (animating) skipRequested = true;
  }

  function buildRow(step) {
    const row = document.createElement('div');
    row.className = `row ${step.role}`;

    const bubble = document.createElement('div');
    let body;

    if (step.kind === 'user') {
      bubble.className = 'bubble user';
      bubble.innerHTML = '<span class="label">You</span>';
      body = document.createElement('div');
      bubble.appendChild(body);
    } else if (step.kind === 'thinking') {
      bubble.className = 'bubble thinking';
      bubble.innerHTML = '<span class="label">💭 Thinking</span>';
      body = document.createElement('div');
      bubble.appendChild(body);
    } else if (step.kind === 'text') {
      bubble.className = 'bubble text';
      bubble.innerHTML = '<span class="label">Claude</span>';
      body = document.createElement('div');
      bubble.appendChild(body);
    } else if (step.kind === 'tool') {
      bubble.className = 'bubble tool';
      const head = document.createElement('div');
      head.className = 'tool-head';
      const icon = TOOL_ICONS[step.toolName] || '🔧';
      head.innerHTML = `<span class="tool-icon">${icon}</span><span class="tool-name">${escapeHtml(
        step.toolName || 'tool'
      )}</span>`;
      bubble.appendChild(head);

      const inputLabel = document.createElement('span');
      inputLabel.className = 'tool-input-label';
      inputLabel.textContent = 'input';
      bubble.appendChild(inputLabel);

      body = document.createElement('div');
      body.className = 'tool-input';
      bubble.appendChild(body);
    }

    row.appendChild(bubble);
    return { row, bubble, body };
  }

  async function revealStep(step) {
    const { row, bubble, body } = buildRow(step);
    transcriptEl.appendChild(row);
    stageEl.scrollTop = stageEl.scrollHeight;

    if (step.kind === 'text') {
      await typeInto(body, step.text, { min: 4, max: 16 });
      body.innerHTML = renderMarkdown(step.text);
    } else if (step.kind === 'thinking') {
      await typeInto(body, step.text, { min: 3, max: 12 });
    } else if (step.kind === 'user') {
      await typeInto(body, step.text, { min: 6, max: 20 });
    } else if (step.kind === 'tool') {
      const inputText = formatToolInput(step);
      await typeInto(body, shorten(inputText, TOOL_INPUT_LIMIT), { min: 2, max: 9 });
      attachExpander(bubble, body, inputText, TOOL_INPUT_LIMIT);

      if (step.result) {
        const resultLabel = document.createElement('span');
        resultLabel.className = 'tool-result-label';
        resultLabel.textContent = step.resultIsError ? 'error' : 'result';
        bubble.appendChild(resultLabel);

        const resultBody = document.createElement('div');
        resultBody.className = 'tool-result' + (step.resultIsError ? ' error' : '');
        bubble.appendChild(resultBody);

        await typeInto(resultBody, shorten(step.result, TOOL_RESULT_LIMIT), { min: 1, max: 6 });
        attachExpander(bubble, resultBody, step.result, TOOL_RESULT_LIMIT);
      }
    }
    stageEl.scrollTop = stageEl.scrollHeight;
  }

  function renderStaticUpTo(n) {
    // 一気に(アニメーション無しで) n 件を表示する。back の後の再構築などに使う。
    transcriptEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const step = steps[i];
      const { row, bubble, body } = buildRow(step);
      transcriptEl.appendChild(row);
      if (step.kind === 'text') {
        body.innerHTML = renderMarkdown(step.text);
      } else if (step.kind === 'tool') {
        const inputText = formatToolInput(step);
        body.textContent = shorten(inputText, TOOL_INPUT_LIMIT);
        attachExpander(bubble, body, inputText, TOOL_INPUT_LIMIT);
        if (step.result) {
          const resultLabel = document.createElement('span');
          resultLabel.className = 'tool-result-label';
          resultLabel.textContent = step.resultIsError ? 'error' : 'result';
          bubble.appendChild(resultLabel);
          const resultBody = document.createElement('div');
          resultBody.className = 'tool-result' + (step.resultIsError ? ' error' : '');
          resultBody.textContent = shorten(step.result, TOOL_RESULT_LIMIT);
          bubble.appendChild(resultBody);
          attachExpander(bubble, resultBody, step.result, TOOL_RESULT_LIMIT);
        }
      } else {
        body.textContent = step.text;
      }
    }
    stageEl.scrollTop = stageEl.scrollHeight;
  }

  function updateProgress() {
    progressLabel.textContent = `${index} / ${steps.length}`;
    btnNext.textContent = animating ? '⏩ スキップ' : '進む ▶';
    progressFill.style.width = steps.length ? `${(index / steps.length) * 100}%` : '0%';
    btnBack.disabled = index === 0 || animating;
    // タイプ中も押せるようにしておく (押すと全文表示にスキップする)
    btnNext.disabled = index >= steps.length && !animating;
    btnRestart.disabled = index === 0 && !animating;
  }

  async function goNext() {
    if (animating || index >= steps.length) return;
    updateProgress();
    index += 1;
    await revealStep(steps[index - 1]);
    updateProgress();
  }

  function goBack() {
    if (animating || index === 0) return;
    index -= 1;
    renderStaticUpTo(index);
    updateProgress();
  }

  function restart() {
    if (animating) return;
    index = 0;
    transcriptEl.innerHTML = '';
    updateProgress();
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  }

  async function init() {
    const res = await fetch('/api/session');
    const data = await res.json();
    steps = data.steps || [];

    const meta = data.meta || {};
    sessionMetaEl.innerHTML = `
      <div><b>${escapeHtml(data.sessionName || '')}</b></div>
      <div>${escapeHtml(meta.cwd || '')} ${meta.gitBranch ? '(' + escapeHtml(meta.gitBranch) + ')' : ''}</div>
      <div>${fmtDate(meta.firstTimestamp)} 〜 ${fmtDate(meta.lastTimestamp)}</div>
    `;

    if (steps.length === 0) {
      transcriptEl.innerHTML = '<div class="empty-state">表示できるやりとりが無かったよ</div>';
      return;
    }

    // ?start=N で途中から開いた状態にできる (デモの再開用)
    const startParam = parseInt(new URLSearchParams(location.search).get('start'), 10);
    if (!Number.isNaN(startParam) && startParam > 0) {
      index = Math.min(startParam, steps.length);
      renderStaticUpTo(index);
    }

    updateProgress();

    btnNext.addEventListener('click', () => {
      if (animating) requestSkip();
      else goNext();
    });
    btnBack.addEventListener('click', goBack);
    btnRestart.addEventListener('click', restart);
    stageEl.addEventListener('click', requestSkip);
    speedSelect.addEventListener('change', () => {
      speed = Number(speedSelect.value);
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
        if (animating) requestSkip();
        else goNext();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
    });
  }

  init();
})();
