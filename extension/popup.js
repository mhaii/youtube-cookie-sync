/*
Loaded into popup index.html
*/

'use strict';

let browserType = getBrowser();

function getBrowser() {
  if (typeof chrome !== 'undefined') {
    if (typeof browser !== 'undefined') {
      return browser;
    } else {
      return chrome;
    }
  } else {
    console.log('failed to detect browser');
    throw 'browser detection error';
  }
}

async function sendMessage(message) {
  const { success, value } = await browserType.runtime.sendMessage(message);
  if (!success) throw value;
  return value;
}

const errorOut = document.getElementById('error-out');
function setError(message) {
  errorOut.style.display = 'initial';
  errorOut.innerText = message;
}
function clearError() {
  errorOut.style.display = 'none';
}

const syncErrorEl = document.getElementById('sync-error');
function setSyncError(message) {
  syncErrorEl.style.display = 'block';
  syncErrorEl.innerText = message;
}
function clearSyncError() {
  syncErrorEl.style.display = 'none';
  syncErrorEl.innerText = '';
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function updateSyncStatus(lastSync) {
  const el = document.getElementById('sync-status');
  if (!lastSync) {
    el.innerText = '—';
    clearSyncError();
    return;
  }
  if (lastSync.status === 'ok') {
    el.innerText = formatTimestamp(lastSync.timestamp);
    clearSyncError();
  } else {
    el.innerText = formatTimestamp(lastSync.timestamp) + ' — failed';
    setSyncError(lastSync.message || 'Unknown error');
  }
}

// generate a random 32-char hex PSK
function generatePsk() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// save config
document.getElementById('save-config').addEventListener('click', () => {
  clearError();
  const endpointUrl = document.getElementById('endpoint-url').value.trim();
  const psk = document.getElementById('psk').value.trim();

  if (!endpointUrl) {
    setError('Endpoint URL is required');
    return;
  }
  if (!psk) {
    setError('PSK is required');
    return;
  }

  browserType.storage.local.set({ config: { endpointUrl, psk } }, () => {
    console.log('Config saved');
  });
});

// generate PSK button
document.getElementById('generate-psk').addEventListener('click', () => {
  document.getElementById('psk').value = generatePsk();
  document.getElementById('psk').type = 'text';
  setTimeout(() => {
    document.getElementById('psk').type = 'password';
  }, 3000);
});

// sync now
document.getElementById('sendCookies').addEventListener('click', () => {
  clearError();
  clearSyncError();
  document.getElementById('sync-status').innerText = 'Syncing…';

  sendMessage({ type: 'sendCookie' })
    .then(result => {
      sendMessage({ type: 'getLastSync' }).then(updateSyncStatus);
      if (!result?.success && result?.message) {
        setSyncError(result.message);
      }
    })
    .catch(err => {
      console.error(err);
      setError(String(err));
      sendMessage({ type: 'getLastSync' }).then(updateSyncStatus);
    });
});

// show/hide raw cookies
document.getElementById('showCookies').addEventListener('click', () => {
  const textArea = document.getElementById('cookieLinesResponse');
  if (textArea.value) {
    textArea.value = '';
    textArea.style.display = 'none';
    document.getElementById('showCookies').textContent = 'Show Cookies';
  } else {
    sendMessage({ type: 'getCookieLines' })
      .then(lines => {
        textArea.value = lines.join('\n');
        textArea.style.display = 'block';
        document.getElementById('showCookies').textContent = 'Hide Cookies';
      })
      .catch(err => setError(String(err)));
  }
});

// continuous sync toggle
document.getElementById('continuous-sync').addEventListener('click', () => {
  const checked = document.getElementById('continuous-sync').checked;
  browserType.storage.local.set({ continuousSync: { checked } }, () => {
    console.log('continuousSync set to', checked);
  });
  sendMessage({ type: 'continuousSync', checked }).catch(err => setError(String(err)));
});

// on load: populate fields and status
document.addEventListener('DOMContentLoaded', () => {
  browserType.storage.local.get(['config', 'continuousSync', 'lastSync'], result => {
    if (result.config) {
      document.getElementById('endpoint-url').value = result.config.endpointUrl || '';
      document.getElementById('psk').value = result.config.psk || '';
    } else {
      // auto-generate a PSK on first open if none configured
      document.getElementById('psk').value = generatePsk();
    }

    if (result.continuousSync?.checked) {
      document.getElementById('continuous-sync').checked = true;
    }

    updateSyncStatus(result.lastSync || null);
  });
});