/**
 * 内容脚本：选中文字后浮出「翻译」按钮，翻译结果以内联气泡展示
 */
'use strict';

const STYLE_OK = '';
let floatBtn = null;
let bubble = null;

function getTL() {
    return new Promise(resolve => {
        chrome.storage.sync.get({ tl: 'zh-CN' }, cfg => resolve(cfg.tl));
    });
}

function ensureBtn() {
    if (floatBtn) return floatBtn;
    floatBtn = document.createElement('div');
    floatBtn.className = 'gtrans-float-btn';
    floatBtn.textContent = '翻译';
    floatBtn.addEventListener('click', onTranslateClick);
    document.body.appendChild(floatBtn);
    return floatBtn;
}

function hideBtn() {
    if (floatBtn) floatBtn.style.display = 'none';
}

function showBtn(rect) {
    const btn = ensureBtn();
    btn.style.display = 'block';
    btn.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    btn.style.left = (rect.left + window.scrollX) + 'px';
}

function removeBubble() {
    if (bubble) { bubble.remove(); bubble = null; }
}

function showBubble(sourceRect, sourceText, result) {
    removeBubble();
    bubble = document.createElement('div');
    bubble.className = 'gtrans-bubble';
    bubble.innerHTML = `
        <div class="gtrans-bubble-head"><span>谷歌翻译</span><button class="gtrans-close">×</button></div>
        <div class="gtrans-source"></div>
        <div class="gtrans-result"></div>`;
    bubble.querySelector('.gtrans-source').textContent = sourceText;
    bubble.querySelector('.gtrans-result').textContent = result;

    document.body.appendChild(bubble);
    const bw = bubble.offsetWidth;
    let left = sourceRect.left + window.scrollX;
    if (left + bw > window.scrollX + window.innerWidth - 10) {
        left = window.scrollX + window.innerWidth - bw - 10;
    }
    bubble.style.left = Math.max(8, left) + 'px';
    let top = sourceRect.top + window.scrollY - bubble.offsetHeight - 8;
    if (top < window.scrollY + 8) {
        top = sourceRect.bottom + window.scrollY + 8;
    }
    bubble.style.top = top + 'px';

    bubble.querySelector('.gtrans-close').addEventListener('click', removeBubble);
}

async function onTranslateClick() {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : { left: 0, top: 0, bottom: 0 };
    if (!text) return;
    const tl = await getTL();
    showBubble(rect, text, '翻译中…');
    try {
        const res = await chrome.runtime.sendMessage({ type: 'translate', text, tl });
        if (res && res.ok) {
            showBubble(rect, text, res.result);
        } else {
            showBubble(rect, text, '翻译失败：' + (res && res.error || ''));
        }
    } catch (e) {
        showBubble(rect, text, '翻译失败：' + e.message);
    }
}

// 监听选中事件
document.addEventListener('mouseup', () => {
    setTimeout(() => {
        const sel = window.getSelection();
        const text = sel.toString().trim();
        if (!text || !sel.rangeCount) {
            if (!bubble) hideBtn();
            return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) { hideBtn(); return; }
        showBtn(rect);
    }, 10);
});

// 点击空白处收起
document.addEventListener('mousedown', e => {
    if (floatBtn && floatBtn.contains(e.target)) return;
    if (bubble && bubble.contains(e.target)) return;
    if (!window.getSelection().toString().trim()) {
        hideBtn();
        removeBubble();
    }
});

// 右键菜单翻译结果回显
chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'showTranslation') {
        const sel = window.getSelection();
        const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : { left: 0, top: 0, bottom: 0, width: 0 };
        showBubble(rect, msg.source, msg.result);
    }
});
