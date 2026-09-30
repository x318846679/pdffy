/**
 * 后台 service worker：调用谷歌翻译（无需 API Key），含缓存与失败回退
 */
'use strict';

const ENDPOINTS = [
    'https://translate.googleapis.com/translate_a/single?client=gtx&ie=UTF-8&oe=UTF-8',
    'https://translate.google.com/translate_a/single?client=gtx&ie=UTF-8&oe=UTF-8'
];

let endpointIndex = 0;
const cache = new Map();

function getTargetLang() {
    return new Promise(resolve => {
        chrome.storage.sync.get({ tl: 'zh-CN' }, cfg => resolve(cfg.tl));
    });
}

async function translate(text, tl, sl = 'auto') {
    const clean = (text || '').trim();
    if (!clean) return '';

    const key = `${tl}|${sl}|${clean}`;
    if (cache.has(key)) return cache.get(key);

    let lastErr = null;
    for (let i = 0; i < ENDPOINTS.length; i++) {
        const base = ENDPOINTS[(endpointIndex + i) % ENDPOINTS.length];
        const url = `${base}&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(clean)}`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('bad response');
            endpointIndex = (endpointIndex + i) % ENDPOINTS.length;
            const out = data[0].map(seg => (seg && seg[0]) ? seg[0] : '').join('');
            cache.set(key, out);
            return out;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('翻译失败');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'translate') {
        translate(msg.text, msg.tl, msg.sl || 'auto')
            .then(result => sendResponse({ ok: true, result }))
            .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
        return true; // 异步响应
    }
});

// 右键菜单：翻译选中内容
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'gtrans-selection',
        title: '用谷歌翻译翻译选中内容',
        contexts: ['selection']
    });

    // 右键打开 PDF 翻译阅读器（不限制 URL，确保网页 PDF / 阅读器框架也能出现）
    chrome.contextMenus.create({
        id: 'open-pdf-viewer',
        title: '用 PDF 翻译阅读器打开',
        contexts: ['page', 'link', 'frame']
    });
});

// 从右键信息中挑出可抓取的 PDF 直链（仅 http/https）
function pickPdfUrl(info) {
    const candidates = [info.linkUrl, info.srcUrl, info.frameUrl, info.pageUrl];
    for (const u of candidates) {
        if (u && /^https?:\/\//i.test(u)) return u;
    }
    // 若拿到的是 Chrome 内置 PDF 阅读器框架地址，尝试提取真实直链
    const raw = info.frameUrl || info.pageUrl || '';
    if (/mhjfbmdgcfjbbpaeojofohoefgiehjai/.test(raw)) {
        const mm = raw.match(/[?&](?:file|src|url)=([^&]+)/i);
        if (mm) {
            const dec = decodeURIComponent(mm[1]);
            if (/^https?:\/\//i.test(dec)) return dec;
        }
    }
    return null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'open-pdf-viewer') {
        const url = pickPdfUrl(info);
        const base = chrome.runtime.getURL('viewer.html');
        if (url) {
            chrome.tabs.create({ url: base + '?file=' + encodeURIComponent(url) });
        } else {
            chrome.tabs.create({ url: base + '?msg=' + encodeURIComponent(
                '无法自动获取该 PDF 直链（地址协议不受支持或被隐藏）。' +
                '请：① 下载 PDF 后点「打开 PDF」选择文件；' +
                '② 或在上方输入框粘贴 PDF 的 http/https 直链。'
            ) });
        }
        return;
    }

    if (info.menuItemId !== 'gtrans-selection' || !info.selectionText) return;
    const tl = await getTargetLang();
    try {
        const result = await translate(info.selectionText, tl);
        chrome.tabs.sendMessage(tab.id, {
            type: 'showTranslation',
            source: info.selectionText,
            result
        });
    } catch (e) {
        chrome.tabs.sendMessage(tab.id, {
            type: 'showTranslation',
            source: info.selectionText,
            result: '翻译失败：' + (e.message || e)
        });
    }
});
