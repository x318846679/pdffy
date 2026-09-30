'use strict';

const tlSel = document.getElementById('tl');
const srcEl = document.getElementById('src');
const resultEl = document.getElementById('result');
const goBtn = document.getElementById('go');

// 读取已保存的默认目标语言
chrome.storage.sync.get({ tl: 'zh-CN' }, cfg => {
    tlSel.value = cfg.tl;
});

// 切换语言即保存为全站默认
tlSel.addEventListener('change', () => {
    chrome.storage.sync.set({ tl: tlSel.value });
});

goBtn.addEventListener('click', async () => {
    const text = srcEl.value.trim();
    if (!text) { resultEl.textContent = '请输入文本'; return; }
    resultEl.textContent = '翻译中…';
    try {
        const res = await chrome.runtime.sendMessage({ type: 'translate', text, tl: tlSel.value });
        resultEl.textContent = (res && res.ok) ? res.result : '翻译失败：' + (res && res.error || '');
    } catch (e) {
        resultEl.textContent = '翻译失败：' + e.message;
    }
});

// 打开扩展内置的 PDF 翻译阅读器
document.getElementById('openViewer').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});
