/**
    MyGet - A multi-thread downloading library
    Copyright (C) 2014-2022 [Chandler Stimson]

    This program is free software: you can redistribute it and/or modify
    it under the terms of the Mozilla Public License as published by
    the Mozilla Foundation, either version 2 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    Mozilla Public License for more details.
    You should have received a copy of the Mozilla Public License
    along with this program.  If not, see {https://www.mozilla.org/en-US/MPL/}.

    GitHub: https://github.com/chandler-stimson/live-stream-downloader/
    Homepage: https://webextension.org/listing/hls-downloader.html
*/

/* global network */

if (typeof importScripts !== 'undefined') {
  self.importScripts('network/core.js');
  self.importScripts('network/icon.js');
  self.importScripts('context.js');
  self.importScripts('/plugins/blob-detector/core.js');
}

self.notify = (tabId, text, title) => {
  chrome.action.setBadgeBackgroundColor({
    color: 'red'
  });
  chrome.action.setBadgeText({
    tabId,
    text
  });
  chrome.action.setTitle({
    tabId,
    title
  });
};

/* extra objects */
const extra = {};

const open = async (tab, extra = []) => {
  const win = await chrome.windows.getCurrent();

  chrome.storage.local.get({
    width: 800,
    height: 500 // for Windows we need this
  }, prefs => {
    const left = win.left + Math.round((win.width - 800) / 2);
    const top = win.top + Math.round((win.height - 500) / 2);

    const args = new URLSearchParams();
    args.set('tabId', tab.id);
    args.set('title', tab.title || '');
    args.set('href', tab.url || '');
    for (const {key, value} of extra) {
      args.set(key, value);
    }

    chrome.windows.create({
      url: '/data/job/index.html?' + args.toString(),
      width: prefs.width,
      height: prefs.height,
      left,
      top,
      type: 'popup'
    });
  });
};
chrome.action.onClicked.addListener(tab => open(tab));
chrome.action.setBadgeBackgroundColor({
  color: '#666666'
});

const badge = (n, tabId) => {
  if (n) {
    chrome.action.setIcon({
      tabId: tabId,
      path: {
        '16': '/data/icons/active/16.png',
        '32': '/data/icons/active/32.png',
        '48': '/data/icons/active/48.png'
      }
    });

    chrome.action.setBadgeText({
      tabId: tabId,
      text: new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1
      }).format(n)
    });
  }
  else {
    chrome.action.setIcon({
      tabId: tabId,
      path: {
        '16': '/data/icons/16.png',
        '32': '/data/icons/32.png',
        '48': '/data/icons/48.png'
      }
    });
    chrome.action.setBadgeText({
      tabId: tabId,
      text: ''
    });
  }
};

const observe = d => {
  // unsupported content types
  if (
    d.url.includes('.m3u8') === false &&
    d.url.includes('.mpd') === false &&
    d.type !== 'media' &&
    d.responseHeaders.some(({name, value}) => {
      return (name === 'content-type' || name === 'Content-Type') && value && value.startsWith('text/html');
    })) {
    return;
  }

  chrome.scripting.executeScript({
    target: {
      tabId: d.tabId
    },
    func: (size, v) => {
      self.storage = self.storage || new Map();
      self.storage.set(v.url, v);
      if (self.storage.size > size) {
        for (const [href] of self.storage) {
          self.storage.delete(href);
          if (self.storage.size <= size) {
            break;
          }
        }
      }

      return self.storage.size;
    },
    args: [200, {
      url: d.url,
      initiator: d.initiator,
      timeStamp: d.timeStamp,
      responseHeaders: d.responseHeaders.filter(o => network.HEADERS.includes(o.name.toLowerCase()))
    }]
  }).then(c => badge(c[0].result, d.tabId)).catch(() => {});
};
observe.mime = d => {
  for (const {name, value} of d.responseHeaders) {
    if ((name === 'content-type' || name === 'Content-Type') && value && (
      value.startsWith('video/') || value.startsWith('audio/')
    )) {
      return observe(d);
    }
  }
};

/* clear old list on remove */
chrome.tabs.onRemoved.addListener(tabId => {
  // clear rules
  chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId]
  });
});

/* clear old list on reload */
// chrome.tabs.onUpdated.addListener((tabId, info) => {
//   if (info.status === 'loading') {
//     badge(0, tabId);
//   }
// });

// media
chrome.webRequest.onHeadersReceived.addListener(observe, {
  urls: ['*://*/*'],
  types: ['media']
}, ['responseHeaders']);

// media types
network.types({
  core: true
}).then(types => {
  const cloned = navigator.userAgent.includes('Firefox') ? d => observe(d) : observe;

  chrome.webRequest.onHeadersReceived.addListener(cloned, {
    urls: types.map(s => '*://*/*.' + s + '*'),
    types: ['xmlhttprequest']
  }, ['responseHeaders']);
});

// https://iandevlin.com/html5/webvtt-example.html
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track
// https://demos.jwplayer.com/closed-captions/
network.types({
  core: false,
  sub: true
}).then(types => {
  const cloned = navigator.userAgent.includes('Firefox') ? d => observe(d) : observe;

  chrome.webRequest.onHeadersReceived.addListener(cloned, {
    urls: types.map(s => '*://*/*.' + s + '*'),
    types: ['xmlhttprequest', 'other']
  }, ['responseHeaders']);
});

// watch for video and audio mime-types
{
  const run = () => chrome.storage.local.get({
    'mime-watch': false
  }, prefs => {
    if (prefs['mime-watch']) {
      chrome.webRequest.onHeadersReceived.addListener(observe.mime, {
        urls: ['*://*/*'],
        types: ['xmlhttprequest']
      }, ['responseHeaders']);
    }
    else {
      chrome.webRequest.onHeadersReceived.removeListener(observe.mime);
    }
  });
  run();
  chrome.storage.onChanged.addListener(ps => ps['mime-watch'] && run());
}

const raip = () => {
  if (chrome.power) {
    chrome.runtime.sendMessage({
      method: 'any-active'
    }, r => {
      chrome.runtime.lastError;
      if (r !== true) {
        chrome.power.releaseKeepAwake();
      }
    });
  }
};

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'release-awake-if-possible') {
    raip();
  }
  else if (request.method === 'get-extra') {
    response(extra[request.tabId] || []);
    delete extra[request.tabId];
  }
  else if (request.method === 'media-detected') {
    observe({
      ...request.d,
      timeStamp: Date.now(),
      tabId: sender.tab.id,
      initiator: sender.url
    });
  }
});
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'release-awake-if-possible') {
    raip();
  }
});

/* delete all leftover cache requests */
{
  const once = async () => {
    for (const key of await caches.keys()) {
      caches.delete(key);
    }
  };
  chrome.runtime.onStartup.addListener(once);
}

/* delete all old indexedDB databases left from "v2" version */
{
  const once = () => indexedDB.databases().then(dbs => {
    for (const db of dbs) {
      indexedDB.deleteDatabase(db.Name);
    }
  });
  if (indexedDB.databases) {
    chrome.runtime.onInstalled.addListener(once);
    chrome.runtime.onStartup.addListener(once);
  }
}

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const {homepage_url: page, name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
