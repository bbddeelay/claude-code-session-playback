'use strict';

const { spawn, execSync } = require('child_process');

const CHROMIUM_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
];

function which(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.platform === 'linux') {
    const chromium = CHROMIUM_CANDIDATES.find(which);
    if (chromium) {
      spawn(chromium, ['--new-window', url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (which('xdg-open')) {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  } else if (process.platform === 'darwin') {
    const chromium = ['Google Chrome', 'Chromium'];
    for (const app of chromium) {
      try {
        execSync(`open -Ra "${app}"`, { stdio: 'ignore' });
        spawn('open', ['-a', app, url], { detached: true, stdio: 'ignore' }).unref();
        return;
      } catch {
        // try next
      }
    }
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  } else if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  console.log(`ブラウザを自動で開けなかったから、このURLを開いてね: ${url}`);
}

module.exports = { openBrowser };
