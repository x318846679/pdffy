/**
 * PDF 阅读 + 谷歌翻译浮层（扩展内运行，译文走后台沙箱避免 CORS）
 */
(function () {
    'use strict';

    const isExt = !!(window.chrome && chrome.runtime && chrome.runtime.id);
    pdfjsLib.GlobalWorkerOptions.workerSrc = isExt
        ? chrome.runtime.getURL('lib/pdf.worker.min.js')
        : 'lib/pdf.worker.min.js';

    const $ = id => document.getElementById(id);
    const viewer = $('viewer');
    const fileInput = $('fileInput');
    const targetLang = $('targetLang');
    const modeSel = $('mode');
    const pageInfo = $('pageInfo');
    const statusEl = $('status');
    const progressBar = $('progressBar');

    let pdfDoc = null;
    let allBlocks = [];
    let rendering = false;
    let stopped = false;

    /* ---------------- 翻译后端 ---------------- */

    async function translateOne(text, tl) {
        const clean = (text || '').trim();
        if (!clean) return '';
        if (isExt) {
            const res = await chrome.runtime.sendMessage({ type: 'translate', text: clean, tl });
            if (res && res.ok) return res.result;
            throw new Error((res && res.error) || 'bg translate failed');
        }
        // 回退：直接调用（仅本地网页打开时可用）
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&ie=UTF-8&oe=UTF-8&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(clean)}`;
        const r = await fetch(url);
        const data = await r.json();
        return data[0].map(s => (s && s[0]) ? s[0] : '').join('');
    }

    async function batchTranslate(items, tl, onItem) {
        stopped = false;
        let done = 0;
        const CONC = 4;
        let idx = 0;
        const worker = async () => {
            while (idx < items.length) {
                if (stopped) return;
                const it = items[idx++];
                try {
                    const r = await translateOne(it.text, tl);
                    onItem(++done, items.length, it, r);
                } catch (e) {
                    onItem(++done, items.length, it, '');
                }
                await new Promise(s => setTimeout(s, 60));
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, worker));
    }

    /* ---------------- 工具 ---------------- */

    function setStatus(t) { statusEl.textContent = t; }
    function setProgress(p) { progressBar.style.width = Math.max(0, Math.min(100, p)) + '%'; }
    function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    /* ---------------- 加载 ---------------- */

    fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f && f.type === 'application/pdf') await loadFile(f);
    });

    async function loadFile(file) {
        try {
            setStatus('正在解析 PDF…');
            const buf = await file.arrayBuffer();
            pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
            pageInfo.textContent = `共 ${pdfDoc.numPages} 页`;
            await renderAll();
            setStatus('就绪');
        } catch (err) {
            console.error(err);
            setStatus('加载失败：' + err.message);
        }
    }

    /* ---------------- 渲染（按需虚拟化） ---------------- */

    let zoom = 1;                 // 缩放系数（基于适应宽度）
    let pageDims = [];            // 每页基础尺寸 {w,h}（scale=1）
    let renderedPages = new Set();
    let renderToken = 0;
    const RENDER_BUFFER = 2;      // 视口上下各多渲染的页数

    function containerWidth() {
        return Math.min(viewer.clientWidth - 40, 1000) * zoom;
    }

    function effScale(n) {
        const d = pageDims[n];
        return d ? containerWidth() / d.w : 1;
    }

    async function analyzePages() {
        pageDims = [null];
        for (let n = 1; n <= pdfDoc.numPages; n++) {
            const p = await pdfDoc.getPage(n);
            const base = p.getViewport({ scale: 1 });
            pageDims[n] = { w: base.width, h: base.height };
        }
    }

    async function buildLayout() {
        rendering = true;
        viewer.innerHTML = '';
        allBlocks = [];
        renderedPages.clear();
        setStatus('正在排版页面…');
        for (let n = 1; n <= pdfDoc.numPages; n++) {
            const d = pageDims[n];
            const sc = containerWidth() / d.w;
            const div = document.createElement('div');
            div.className = 'page';
            div.dataset.page = n;
            div.style.width = (d.w * sc) + 'px';
            div.style.height = (d.h * sc) + 'px';
            div.innerHTML = '<div class="page-loading">加载中…</div>';
            viewer.appendChild(div);
        }
        applyMode();
        await renderWindow();
        rendering = false;
        setStatus('就绪');
    }

    async function renderAll() {
        await analyzePages();
        await buildLayout();
    }

    function renderPageInto(n) {
        if (renderedPages.has(n)) return Promise.resolve();
        renderedPages.add(n);
        const div = viewer.querySelector('.page[data-page="' + n + '"]');
        if (!div) return Promise.resolve();
        const loader = div.querySelector('.page-loading');
        if (loader) loader.remove();
        return (async () => {
            const page = await pdfDoc.getPage(n);
            const viewport = page.getViewport({ scale: effScale(n) });
            const dpr = window.devicePixelRatio || 1;

            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width * dpr);
            canvas.height = Math.floor(viewport.height * dpr);
            canvas.style.width = viewport.width + 'px';
            canvas.style.height = viewport.height + 'px';
            div.appendChild(canvas);

            const textLayer = document.createElement('div');
            textLayer.className = 'text-layer';
            div.appendChild(textLayer);

            const transLayer = document.createElement('div');
            transLayer.className = 'trans-layer';
            div.appendChild(transLayer);

            const badge = document.createElement('div');
            badge.className = 'page-badge';
            badge.textContent = n + ' / ' + pdfDoc.numPages;
            div.appendChild(badge);

            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            await page.render({ canvasContext: ctx, viewport }).promise;

            const items = await buildBlocks(page, viewport, textLayer);
            allBlocks.push({ page: n, items, layer: transLayer, pageWidth: viewport.width, pageHeight: viewport.height, translated: false });
        })();
    }

    // 只渲染视口附近（含缓冲）的页面，保证大文档也不卡
    async function renderWindow() {
        if (!pdfDoc) return;
        const token = ++renderToken;
        const top = viewer.scrollTop, h = viewer.clientHeight;
        const nodes = [...viewer.querySelectorAll('.page')];
        const vis = [];
        nodes.forEach(node => {
            const r = node.offsetTop;
            if (r + node.offsetHeight > top - 240 && r < top + h + 240) vis.push(parseInt(node.dataset.page, 10));
        });
        if (!vis.length) return;
        const want = new Set();
        vis.forEach(p => {
            for (let d = -RENDER_BUFFER; d <= RENDER_BUFFER; d++) {
                const t = p + d;
                if (t >= 1 && t <= pdfDoc.numPages) want.add(t);
            }
        });
        for (const p of [...want].sort((a, b) => a - b)) {
            if (token !== renderToken) return;   // 滚动已变化，放弃旧任务
            await renderPageInto(p);
        }
    }

    async function buildBlocks(page, viewport, textLayer) {
        const content = await page.getTextContent();
        const lines = [];

        content.items.forEach(item => {
            if (!item.str) return;
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontSize = Math.hypot(tx[2], tx[3]) || item.height || 10;
            const x = tx[4];
            const y = tx[5] - fontSize;
            const w = item.width * viewport.scale;

            let line = lines.find(l => Math.abs(l.y - y) < fontSize * 0.45 && l.pageH === Math.round(fontSize));
            if (!line) { line = { y, x, w, fontSize, parts: [], pageH: Math.round(fontSize) }; lines.push(line); }
            line.parts.push({ x, str: item.str, w });
            line.x = Math.min(line.x, x);
            line.w = Math.max(line.w, x + w);
        });

        lines.forEach(l => {
            l.parts.sort((a, b) => a.x - b.x);
            l.text = l.parts.map(p => p.str).join('').replace(/\s+/g, ' ').trim();
        });

        const usable = lines.filter(l => l.text.length > 1).sort((a, b) => a.y - b.y);

        // 原文层（仅原文模式可见）
        usable.forEach(b => {
            const span = document.createElement('span');
            span.textContent = b.text;
            span.style.left = b.x + 'px';
            span.style.top = b.y + 'px';
            span.style.fontSize = b.fontSize + 'px';
            span.style.fontFamily = 'sans-serif';
            textLayer.appendChild(span);
        });

        // 将相邻行合并为段落块，便于整块覆盖原文，避免逐词重叠
        const blocks = [];
        let cur = null;
        for (const l of usable) {
            if (!cur) {
                cur = { x: l.x, top: l.y, right: l.x + l.w, bottom: l.y + l.fontSize, fontSize: l.fontSize, text: l.text, n: 1 };
                continue;
            }
            const gap = l.y - cur.bottom;
            const sameCol = Math.abs(l.x - cur.x) < Math.max(cur.fontSize, l.fontSize) * 1.5;
            if (gap < cur.fontSize * 0.8 && sameCol) {
                cur.x = Math.min(cur.x, l.x);
                cur.top = Math.min(cur.top, l.y);
                cur.right = Math.max(cur.right, l.x + l.w);
                cur.bottom = Math.max(cur.bottom, l.y + l.fontSize);
                cur.fontSize = (cur.fontSize * cur.n + l.fontSize) / (cur.n + 1);
                cur.n += 1;
                cur.text += '\n' + l.text;
            } else {
                blocks.push(cur);
                cur = { x: l.x, top: l.y, right: l.x + l.w, bottom: l.y + l.fontSize, fontSize: l.fontSize, text: l.text, n: 1 };
            }
        }
        if (cur) blocks.push(cur);

        return blocks.map(b => ({
            x: b.x,
            y: b.top,
            w: b.right - b.x,
            h: b.bottom - b.top,
            fontSize: b.fontSize,
            text: b.text
        }));
    }

    /* ---------------- 翻译触发 ---------------- */

    function collectItems(pages) {
        const list = [];
        allBlocks.forEach(pb => {
            if (pages && !pages.includes(pb.page)) return;
            pb.items.forEach((b, i) => {
                if (!b.text || !/[A-Za-z\u4e00-\u9fa5]/.test(b.text)) return;
                list.push({ id: pb.page + ':' + i, pb, block: b, text: b.text });
            });
        });
        return list;
    }

    async function doTranslate(items, tl, onItem) {
        if (!items.length) return;
        await batchTranslate(items, tl, onItem);
    }

    async function runTranslate(pages, label) {
        if (!pdfDoc) { setStatus('请先打开 PDF'); return; }
        if (rendering) { setStatus('正在渲染，请稍候'); return; }

        const items = collectItems(pages);
        if (!items.length) { setStatus('没有可翻译的文本'); return; }

        const tl = targetLang.value;
        $('translatePageBtn').disabled = true;
        $('translateAllBtn').disabled = true;
        $('stopBtn').disabled = false;
        setStatus(`${label} 0/${items.length}`);
        setProgress(0);

        await batchTranslate(items, tl, (done, total, item, result) => {
            if (result) paintTranslation(item.pb, item.block, result);
            setStatus(`${label} ${done}/${total}`);
            setProgress((done / total) * 100);
        });

        setStatus(stopped ? '已停止' : '翻译完成');
        $('translatePageBtn').disabled = false;
        $('translateAllBtn').disabled = false;
        $('translateAllBtn').textContent = '自动翻译';
        $('stopBtn').disabled = true;
    }

    // 懒翻译：翻到某页才翻译该页，并预取下一页（不一次性翻译全部）
    let autoTranslate = false;

    async function ensurePageTranslated(pageNum) {
        const existing = allBlocks.find(p => p.page === pageNum);
        if (existing && existing.translated) return;
        await renderPageInto(pageNum);              // 确保该页已渲染
        const pb = allBlocks.find(p => p.page === pageNum);
        if (!pb || pb.translated) return;
        pb.translated = true;
        const items = collectItems([pageNum]);
        if (!items.length) return;
        const tl = targetLang.value;
        await doTranslate(items, tl, (done, total, item, result) => {
            if (result) paintTranslation(item.pb, item.block, result);
            setStatus(`翻译第 ${pageNum} 页 ${done}/${total}`);
        });
    }

    function visiblePages() {
        const top = viewer.scrollTop;
        const h = viewer.clientHeight;
        const res = [];
        viewer.querySelectorAll('.page').forEach(node => {
            const r = node.offsetTop;
            if (r + node.offsetHeight > top - 60 && r < top + h + 60) {
                res.push(parseInt(node.dataset.page, 10));
            }
        });
        return res;
    }

    async function lazyTick() {
        if (!autoTranslate || !pdfDoc) return;
        const vis = visiblePages();
        if (!vis.length) return;
        const maxPage = Math.max(...vis);
        const toDo = vis.slice();
        if (maxPage < pdfDoc.numPages) toDo.push(maxPage + 1); // 预取下一页
        for (const p of toDo) {
            if (!autoTranslate) break;
            await ensurePageTranslated(p);
        }
    }

    function paintTranslation(pb, block, text) {
        const el = document.createElement('div');
        el.className = 'trans-item';
        el.dataset.src = block.text;
        el.innerHTML =
            `<div class="orig">${escapeHtml(block.text)}</div>` +
            `<div class="tr">${escapeHtml(text)}</div>`;

        const width = Math.max(40, pb.pageWidth - block.x - 6);
        el.style.left = block.x + 'px';
        el.style.top = block.y + 'px';
        el.style.width = width + 'px';
        el.style.minHeight = Math.max(block.h, block.fontSize) + 'px';
        el.style.fontSize = Math.max(9, block.fontSize * 0.8) + 'px';

        pb.layer.appendChild(el);
        // 译文过长时自动缩小字号，尽量不压住相邻块
        shrinkToFit(el, Math.max(block.h * 1.1, block.fontSize * 1.6));
    }

    function shrinkToFit(el, maxH) {
        let fs = parseFloat(el.style.fontSize);
        while (el.scrollHeight > maxH && fs > 7) {
            fs -= 0.5;
            el.style.fontSize = fs + 'px';
        }
    }

    /* ---------------- 交互 ---------------- */

    $('translatePageBtn').addEventListener('click', async () => {
        const page = currentVisiblePage();
        await renderPageInto(page);
        runTranslate([page], `第 ${page} 页`);
    });
    $('translateAllBtn').addEventListener('click', () => {
        if (!pdfDoc) { setStatus('请先打开 PDF'); return; }
        autoTranslate = !autoTranslate;
        if (autoTranslate) {
            $('translateAllBtn').textContent = '关闭自动翻译';
            setStatus('已开启自动翻译：滚动到页面即翻译，并预取下一页');
            lazyTick();
        } else {
            $('translateAllBtn').textContent = '自动翻译';
            setStatus('已关闭自动翻译');
        }
    });
    $('stopBtn').addEventListener('click', () => {
        stopped = true;
        autoTranslate = false;
        $('translateAllBtn').textContent = '自动翻译';
        setStatus('已停止');
    });
    $('clearBtn').addEventListener('click', () => {
        autoTranslate = false;
        stopped = true;
        $('translateAllBtn').textContent = '自动翻译';
        allBlocks.forEach(pb => {
            pb.translated = false;
            if (pb.layer) pb.layer.innerHTML = '';
        });
        setStatus('已清除译文');
    });
    modeSel.addEventListener('change', applyMode);

    // 缩放（基于适应宽度，重新排版 + 重渲染视口）
    async function applyZoom(next) {
        zoom = Math.max(0.4, Math.min(3, next));
        $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
        await buildLayout();
        if (autoTranslate) lazyTick();
    }
    $('zoomOutBtn').addEventListener('click', () => applyZoom(zoom - 0.2));
    $('zoomInBtn').addEventListener('click', () => applyZoom(zoom + 0.2));
    $('zoomResetBtn').addEventListener('click', () => applyZoom(1));

    // 跳页
    function goToPage(n) {
        n = Math.max(1, Math.min(pdfDoc ? pdfDoc.numPages : 1, parseInt(n, 10) || 1));
        const div = viewer.querySelector('.page[data-page="' + n + '"]');
        if (div) viewer.scrollTop = div.offsetTop - 12;
    }
    $('gotoBtn').addEventListener('click', () => goToPage($('gotoInput').value));
    $('gotoInput').addEventListener('keydown', e => { if (e.key === 'Enter') goToPage(e.target.value); });

    // 键盘导航
    viewer.addEventListener('keydown', e => {
        const ch = viewer.clientHeight;
        if (e.key === 'PageDown' || e.key === ' ') { viewer.scrollBy(0, ch * 0.9); e.preventDefault(); }
        else if (e.key === 'PageUp') { viewer.scrollBy(0, -ch * 0.9); e.preventDefault(); }
        else if (e.key === 'ArrowDown') { viewer.scrollBy(0, 90); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { viewer.scrollBy(0, -90); e.preventDefault(); }
    });

    // 读取弹窗中保存的默认目标语言
    if (isExt) {
        try {
            chrome.storage.sync.get({ tl: 'zh-CN' }, cfg => { targetLang.value = cfg.tl; });
        } catch (e) { /* ignore */ }
    }

    // 滚动时：按需渲染 + 懒翻译（节流）
    let scrollTimer = null;
    viewer.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            renderWindow();
            if (autoTranslate) lazyTick();
        }, 150);
    }, { passive: true });

    function applyMode() {
        viewer.classList.remove('mode-source', 'mode-target', 'mode-bilingual');
        viewer.classList.add('mode-' + modeSel.value);
    }

    /* ---------------- 右键译文显示原文 ---------------- */

    let origPopup = null;
    function hideOrigPopup() {
        if (origPopup) { origPopup.remove(); origPopup = null; }
    }

    viewer.addEventListener('contextmenu', e => {
        const item = e.target.closest('.trans-item');
        if (!item) return;
        e.preventDefault();
        hideOrigPopup();
        origPopup = document.createElement('div');
        origPopup.className = 'orig-popup';
        origPopup.textContent = item.dataset.src || '';
        document.body.appendChild(origPopup);
        const px = Math.min(e.clientX + 8, window.innerWidth - 380);
        const py = Math.min(e.clientY + 8, window.innerHeight - 120);
        origPopup.style.left = px + 'px';
        origPopup.style.top = py + 'px';
    });
    document.addEventListener('click', hideOrigPopup);

    function currentVisiblePage() {
        const nodes = viewer.querySelectorAll('.page');
        if (!nodes.length) return 1;
        const top = viewer.scrollTop;
        for (const node of nodes) {
            if (node.offsetTop + node.offsetHeight > top + 60) return parseInt(node.dataset.page, 10);
        }
        return nodes.length;
    }

    // 通过 URL 加载 PDF（手动粘贴 / 右键打开传入）
    async function loadFromUrl(url) {
        if (!url) return;
        // 仅支持 http/https 直链；其它协议（chrome-extension/file/chrome 等）无法直接抓取
        if (!/^https?:\/\//i.test(url)) {
            setStatus('无法加载：地址协议不受支持。请下载 PDF 后用「打开 PDF」选择，或在上方输入框粘贴 http/https 直链。');
            return;
        }
        try {
            setStatus('正在加载：' + url);
            const buf = await fetchPdfBytes(url);
            pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
            pageInfo.textContent = `共 ${pdfDoc.numPages} 页`;
            viewer.innerHTML = '';
            await renderAll();
            setStatus('就绪');
        } catch (e) {
            setStatus('加载失败：' + e.message);
        }
    }

    // 直接抓取 PDF 字节（扩展页自带 <all_urls> 主机权限，可绕过 CORS，避免跨消息传二进制）
    async function fetchPdfBytes(url) {
        const opts = { cache: 'no-store', redirect: 'follow' };
        let res = await fetch(url, opts);
        if (!res.ok && (res.status === 401 || res.status === 403)) {
            res = await fetch(url, { ...opts, credentials: 'include' });
        }
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (res.statusText || ''));
        const ct = res.headers.get('content-type') || '';
        if (!/pdf|octet-stream|binary|download/i.test(ct)) {
            throw new Error('返回的不是 PDF（Content-Type: ' + ct + '），请确认是 PDF 直链');
        }
        return new Uint8Array(await res.arrayBuffer());
    }

    // 支持 ?file=xxx / ?msg=xxx 自动处理（右键 PDF 打开时传入）
    (async function autoLoad() {
        const msgM = location.search.match(/[?&]msg=([^&]+)/);
        if (msgM) { setStatus(decodeURIComponent(msgM[1])); return; }
        const m = location.search.match(/[?&]file=([^&]+)/);
        if (m) await loadFromUrl(decodeURIComponent(m[1]));
    })();

    // 工具栏手动粘贴链接回车加载
    $('urlInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') loadFromUrl(e.target.value.trim());
    });
})();
