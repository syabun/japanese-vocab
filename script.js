// ==========================================
// 🌓 夜间模式控制逻辑
// ==========================================
function toggleDarkMode() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.theme = 'light';
    } else {
        html.classList.add('dark');
        localStorage.theme = 'dark';
    }
}

// 1. 初始化高品质默认单词数据 (按本分类组织，新增 mastered 状态标记)
const defaultNotebooks = {
    "日常": [
        {
            id: "1",
            word: "昼[ひる]ご飯[はん]",
            kana: "ひるごはん",
            meaning: "午饭",
            example: "昼ご飯を食べると、眠くなる。(我一吃午饭就犯困。)",
            mastered: false
        },
        {
            id: "3",
            word: "猫[ねこ]",
            kana: "ねこ",
            meaning: "猫咪",
            example: "うちの猫は一日中日向ぼっこをしています。(我家的猫一整天都在晒太阳。)",
            mastered: false
        }
    ],
    "迷宫饭": [
        {
            id: "m1",
            word: "魔物[まもの]",
            kana: "",
            meaning: "魔物，怪物",
            example: "ダンジョンの魔物を美味しくいただきます。(怀着感恩的心享用地下城的魔物。)",
            mastered: false
        },
        {
            id: "m2",
            word: "歩[ある]く鎧[よろい]",
            kana: "",
            meaning: "会动的铠甲",
            example: "歩く鎧の中身は貝類に似ています。(会动的铠甲内部类似于贝类。)",
            mastered: false
        }
    ]
};

// 预装的轻量化内置离线词典数据库（用于本地秒查检索）
const preloadedDictionary = [
    { word: "美味しい", kana: "おいしい", meaning: "美味的，好吃的" },
    { word: "日本語", kana: "にほんご", meaning: "日语" },
    { word: "昼ご飯", kana: "ひるごはん", meaning: "午饭" },
    { word: "猫", kana: "ねこ", meaning: "猫" },
    { word: "朋友", kana: "ともだち", meaning: "朋友" },
    { word: "先生", kana: "せんせい", meaning: "老师" },
    { word: "可愛い", kana: "かわいい", meaning: "可爱的" },
    { word: "ありがとう", kana: "ありがとう", meaning: "谢谢" },
    { word: "寿司", kana: "すし", meaning: "寿司" },
    { word: "樱", kana: "さくら", meaning: "樱花" },
    { word: "勉強", kana: "べんきょう", meaning: "学习，功课" }
];

let notebooks = {};
let activeNotebook = "日常";
let cardFilter = "review"; // "review" (复习中) / "mastered" (已掌握) / "all" (全部)
let activeTagFilters = []; // 当前选中的全局标签（多选，交集过滤；空数组 = 不筛选）
let layoutMode = "grid"; // "grid" (平铺卡片) 或者是 "list" (迷你列表)
let lastDeletedCard = null; // 用于单卡撤销的备忘变量
let lastMasteredCardId = null; // 用于快速撤销掌握状态的备忘变量
let db = null; // IndexedDB 实例
const searchIndexCache = new Map();
let searchDebounceTimer = null;
const cardsPerBatch = 24;
let visibleCardLimit = cardsPerBatch;
let lastCardRenderContext = '';

// 2. 从本地存储加载数据（带向下合并保护机制）
function loadData() {
    const oldData = localStorage.getItem('japanese_vocab_list');
    const notebooksData = localStorage.getItem('japanese_vocab_notebooks');
    const activeNotebookData = localStorage.getItem('japanese_vocab_active');

    if (notebooksData) {
        notebooks = JSON.parse(notebooksData);
        activeNotebook = activeNotebookData || Object.keys(notebooks)[0] || "日常";
    } else if (oldData) {
        notebooks = { "日常": JSON.parse(oldData) };
        if (notebooks["日常"].length === 0) {
            notebooks["日常"] = [...defaultNotebooks["日常"]];
        }
        activeNotebook = "日常";
        saveData();
        showToast("已为你无痛迁移并保留了之前录入的单词！");
    } else {
        notebooks = JSON.parse(JSON.stringify(defaultNotebooks)); // 深拷贝预设
        activeNotebook = "日常";
        saveData();
    }
    
    // 确保活动单词本存在
    if (!notebooks[activeNotebook]) {
        activeNotebook = Object.keys(notebooks)[0] || "日常";
    }

    // 数据清洗：确保每一个旧数据卡片都有 mastered 标志
    Object.keys(notebooks).forEach(bookName => {
        notebooks[bookName].forEach(card => {
            if (card.mastered === undefined) {
                card.mastered = false;
            }
            if (card.tags === undefined) {
                card.tags = [];
            }
        });
    });

    // 恢复上一次保存在本地的 GitHub Gist Token 状态
    const savedToken = localStorage.getItem('gist_token');
    const savedGistId = localStorage.getItem('gist_id');
    if (savedToken) document.getElementById('gist-token').value = savedToken;
    if (savedGistId) document.getElementById('gist-id').value = savedGistId;
    
    renderNotebookTabs();
    renderCards();
    initIndexedDB(); // 异步启动本地词典数据库
}

// 3. 将数据保存至 LocalStorage
function saveData() {
    localStorage.setItem('japanese_vocab_notebooks', JSON.stringify(notebooks));
    localStorage.setItem('japanese_vocab_active', activeNotebook);
    updateHeaderCount();
}

// 4. 解析 bracket 语法格式。比如：日[び] -> <ruby>日<rt>び</rt></ruby> (严格限制平假名粘连，精准对齐)
function parseRubyText(word, fallbackKana) {
    const bracketRegex = /([^\s\[\]\u3040-\u309f]+)\[([^\]]+)\]/g;
    
    if (bracketRegex.test(word)) {
        bracketRegex.lastIndex = 0;
        // 注意这里安全注入了暗金色 class
        return word.replace(bracketRegex, '<ruby>$1<rt class="dark:text-night-gold">$2</rt></ruby>');
    }
    
    if (fallbackKana && fallbackKana.trim() !== "") {
        return `<ruby>${word}<rt class="dark:text-night-gold">${fallbackKana.trim()}</rt></ruby>`;
    }
    
    return word;
}

// Search uses display text, reconstructed reading, kana, meaning, and example as one corpus.
function getCleanWordText(word) {
    return String(word || '').replace(/([^\s\[\]\u3040-\u309f]+)\[([^\]]+)\]/g, '$1');
}

function getRubyReading(word) {
    return String(word || '').replace(/([^\s\[\]\u3040-\u309f]+)\[([^\]]+)\]/g, '$2');
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u30A1-\u30F6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
        .replace(/\s+/g, ' ')
        .trim();
}

function getSearchTerms(query) {
    return normalizeSearchText(query).split(' ').filter(Boolean);
}

function getCachedSearchCorpus(item) {
    const sourceKey = [item.word, item.kana, item.meaning, item.example].join('\u0001');
    const cacheKey = item.id || sourceKey;
    const cached = searchIndexCache.get(cacheKey);
    if (cached && cached.sourceKey === sourceKey) return cached.corpus;

    const corpus = normalizeSearchText([
        getCleanWordText(item.word),
        getRubyReading(item.word),
        item.kana,
        item.meaning,
        item.example
    ].join(' '));
    searchIndexCache.set(cacheKey, { sourceKey, corpus });
    return corpus;
}

function matchesSearchTerms(item, terms) {
    if (terms.length === 0) return true;
    const corpus = getCachedSearchCorpus(item);
    return terms.every(term => corpus.includes(term));
}

function hasGlobalDuplicate(word, excludedCardId = null) {
    const identity = normalizeSearchText(getCleanWordText(word)).replace(/\s+/g, '');
    if (!identity) return false;
    return Object.values(notebooks).some(cards => cards.some(card => {
        if (excludedCardId && card.id === excludedCardId) return false;
        return normalizeSearchText(getCleanWordText(card.word)).replace(/\s+/g, '') === identity;
    }));
}

// 将 1-10 转换为带圈数字 ➊-➓（更有词典感），超出范围回退为「11.」样式
function toCircledNum(n) {
    return n >= 1 && n <= 10 ? String.fromCodePoint(0x2789 + n) : `${n}.`;
}

// 5. 智能分离例句中的日文和中文翻译，以便基于缩放因子动态优雅排版
// 支持用 / 、／（全角斜杠）或换行分隔的多条例句：单句保持原样式，多句自动渲染为带序号的列表
function formatExample(exampleText) {
    if (!exampleText) return '';

    // 按分隔符切分为多条例句，丢弃空段
    const segments = String(exampleText).split(/[/／\n]+/).map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return '';

    // 解析单条例句：从末尾的括号中提取中文翻译（日文部分允许包含空格）
    const parseSegment = (text) => {
        const match = text.match(/^([\s\S]+?)\s*[(（]([^()（）]+)[)）]\s*$/);
        if (match) {
            return { jp: match[1].trim(), cn: match[2].trim() };
        }
        return { jp: text, cn: '' };
    };

    const jpLineCls = 'font-japanese text-stone-800 dark:text-stone-200 font-medium leading-relaxed transition-colors';
    const jpLineStyle = 'font-size: calc(0.84rem * var(--card-scale, 1.0));';
    const cnLineCls = 'text-stone-500 dark:text-stone-400 leading-normal transition-colors';
    const cnLineStyle = 'font-size: calc(0.75rem * var(--card-scale, 1.0));';

    const renderLine = ({ jp, cn }) => `
        <div class="${jpLineCls}" lang="ja" style="${jpLineStyle}">${jp}</div>
        ${cn ? `<div class="${cnLineCls}" style="${cnLineStyle}">${cn}</div>` : ''}
    `;

    // 多条例句：带序号的列表；单句：与原有样式完全一致
    const bodyHtml = segments.length > 1
        ? segments.map((seg, idx) => `
            <div class="flex items-start" style="gap: calc(0.4rem * var(--card-scale, 1.0));${idx > 0 ? ' margin-top: calc(0.5rem * var(--card-scale, 1.0));' : ''}">
                <span class="text-emerald-800/50 dark:text-teal-500/60 shrink-0 transition-colors" style="font-size: calc(0.84rem * var(--card-scale, 1.0)); line-height: 1.625;">${toCircledNum(idx + 1)}</span>
                <div class="min-w-0">${renderLine(parseSegment(seg))}</div>
            </div>
        `).join('')
        : renderLine(parseSegment(segments[0]));

    return `
        <div class="text-left bg-white/70 dark:bg-stone-800/70 rounded-xl border border-stone-200/30 dark:border-stone-700/50 w-full transition-colors" style="padding: calc(0.75rem * var(--card-scale, 1.0));">
            <span class="uppercase font-bold tracking-wider text-emerald-800/50 dark:text-teal-500/60 block transition-colors" style="font-size: var(--fs-tiny, 0.625rem); margin-bottom: calc(0.25rem * var(--card-scale, 1.0));">例句</span>
            ${bodyHtml}
        </div>
    `;
}

// 6. 更新顶部数量统计及徽章状态
function updateHeaderCount() {
    const countEl = document.getElementById('card-count');
    const badgeEl = document.getElementById('active-notebook-badge');
    
    const list = notebooks[activeNotebook] || [];
    const reviewedList = list.filter(c => !c.mastered);
    const masteredList = list.filter(c => c.mastered);

    countEl.innerHTML = `复习中：<strong class="text-emerald-800 dark:text-teal-500 text-sm font-sans mx-0.5">${reviewedList.length}</strong> · 已掌握：<strong class="text-stone-500 dark:text-stone-400 text-sm font-sans mx-0.5">${masteredList.length}</strong>`;
    badgeEl.innerText = activeNotebook;

    renderGlobalTags(); // 更新数量时顺便刷新标签栏
}

// 6.5 渲染全局标签栏（多选交集：可同时选中多个标签，卡片需同时带所有选中标签才显示）
function renderGlobalTags() {
    const container = document.getElementById('global-tags-filter');
    if (!container) return;

    // 全局收集：遍历所有单词本的标签，而非仅当前单词本
    const allTags = new Set();
    Object.keys(notebooks).forEach(bookName => {
        notebooks[bookName].forEach(card => {
            if (card.tags) {
                card.tags.forEach(tag => allTags.add(tag));
            }
        });
    });

    // 清理已被删除（任何卡片都不再使用）的标签选中状态
    activeTagFilters = activeTagFilters.filter(t => allTags.has(t));

    const tagsArray = Array.from(allTags);
    container.innerHTML = '';
    if (tagsArray.length === 0) {
        updateTagScrollFade();
        return; // 如果没有任何标签，不显示筛选栏
    }

    const activeCls = "px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 bg-emerald-100 dark:bg-teal-900/40 text-emerald-800 dark:text-teal-400 border border-emerald-200 dark:border-teal-800 shadow-sm shrink-0";
    const inactiveCls = "px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 bg-transparent text-stone-500 dark:text-stone-400 hover:bg-stone-200/50 dark:hover:bg-stone-700/50 whitespace-nowrap border border-transparent shrink-0";

    // 「全部」按钮：清空所有选中标签（不是可选状态，空选即全部）
    const allBtn = document.createElement('button');
    allBtn.textContent = '全部';
    allBtn.className = activeTagFilters.length === 0 ? activeCls : inactiveCls;
    allBtn.addEventListener('click', () => clearTagFilters());
    container.appendChild(allBtn);

    // 用 createElement + addEventListener 而非内联 onclick，标签含引号也不会出问题
    tagsArray.forEach(tag => {
        const btn = document.createElement('button');
        btn.textContent = tag;
        btn.className = activeTagFilters.includes(tag) ? activeCls : inactiveCls;
        btn.addEventListener('click', () => toggleTagFilter(tag));
        container.appendChild(btn);
    });

    // 滚动/滚轮事件只绑定一次（innerHTML 替换不会影响容器本身）
    if (!container.dataset.scrollBound) {
        container.dataset.scrollBound = '1';
        container.addEventListener('scroll', updateTagScrollFade);
        // 桌面端体验：鼠标悬停在标签栏上时，纵向滚轮转换为横向滑动
        container.addEventListener('wheel', function(e) {
            if (e.deltaY !== 0 && this.scrollWidth > this.clientWidth) {
                e.preventDefault();
                this.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }
    updateTagScrollFade();
}

// 根据滚动位置切换边缘渐隐遮罩，提示「还有内容可滑」
function updateTagScrollFade() {
    const el = document.getElementById('global-tags-filter');
    if (!el) return;
    el.classList.remove('tag-fade-left', 'tag-fade-right', 'tag-fade-both');
    if (el.scrollWidth <= el.clientWidth + 1) return; // 内容没超出，不需要遮罩
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    if (!atStart && !atEnd) el.classList.add('tag-fade-both');
    else if (!atEnd) el.classList.add('tag-fade-right');
    else if (!atStart) el.classList.add('tag-fade-left');
}

// 点击标签：多选 toggle，再次点击取消
window.toggleTagFilter = function(tag) {
    const idx = activeTagFilters.indexOf(tag);
    if (idx >= 0) {
        activeTagFilters.splice(idx, 1);
    } else {
        activeTagFilters.push(tag);
    }
    renderGlobalTags();
    renderCards();
}

// 「全部」按钮：清空所有选中标签
window.clearTagFilters = function() {
    if (activeTagFilters.length === 0) return;
    activeTagFilters = [];
    renderGlobalTags();
    renderCards();
}

// 7. 弹窗非阻塞提示
function showToast(msg, onUndo = null) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    const toastAction = document.getElementById('toast-action');
    
    toastMsg.innerText = msg;
    
    if (onUndo) {
        toastAction.classList.remove('hidden');
        toastAction.onclick = () => {
            onUndo();
            toast.classList.add('translate-y-20', 'opacity-0');
        };
    } else {
        toastAction.classList.add('hidden');
    }
    
    toast.classList.remove('translate-y-20', 'opacity-0');
    
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
    }, 4000);
}

// 8. 切换 单词掌握/复习 状态分类筛选器（三档：复习中 / 已掌握 / 全部）
window.setCardFilter = function(filter) {
    cardFilter = filter;
    const btnIds = { review: 'filter-review-btn', mastered: 'filter-mastered-btn', all: 'filter-all-btn' };
    const activeCls = "px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 bg-white dark:bg-stone-700 text-emerald-800 dark:text-teal-400 shadow-sm whitespace-nowrap";
    const inactiveCls = "px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 whitespace-nowrap";
    Object.keys(btnIds).forEach(key => {
        const btn = document.getElementById(btnIds[key]);
        if (btn) btn.className = (cardFilter === key) ? activeCls : inactiveCls;
    });
    renderCards();
}

// 8.5 新增：卡片平铺与迷你列表视图切换
window.setViewMode = function(mode) {
    layoutMode = mode;
    const gridBtn = document.getElementById('view-grid-btn');
    const listBtn = document.getElementById('view-list-btn');
    const scaleControl = document.getElementById('scale-control-container');
    const gridContainer = document.getElementById('cards-grid');

    if (mode === "grid") {
        gridBtn.className = "px-3.5 py-1.5 w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 bg-white dark:bg-stone-700 text-emerald-800 dark:text-teal-400 shadow-sm flex items-center justify-center space-x-1.5";
        listBtn.className = "px-3.5 py-1.5 w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 flex items-center justify-center space-x-1.5";
        scaleControl.classList.remove('opacity-40', 'pointer-events-none');
        gridContainer.className = "adaptive-grid";
    } else {
        gridBtn.className = "px-3.5 py-1.5 w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 flex items-center justify-center space-x-1.5";
        listBtn.className = "px-3.5 py-1.5 w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 bg-white dark:bg-stone-700 text-emerald-800 dark:text-teal-400 shadow-sm flex items-center justify-center space-x-1.5";
        scaleControl.classList.add('opacity-40', 'pointer-events-none');
        gridContainer.className = "grid grid-cols-1 gap-3 max-w-2xl mx-auto";
    }
    renderCards();
}

// 8.6 修复：无级卡片物理宽度及高度同步等比例缩放 (改变 --card-width 促使 CSS Grid 自动重排)
window.changeCardScale = function(val) {
    const scale = parseFloat(val);
    const grid = document.getElementById('cards-grid');
    grid.style.setProperty('--card-scale', scale);
    // 固定比例缩放：宽 300px，高 380px
    grid.style.setProperty('--card-width', (300 * scale) + 'px');
    grid.style.setProperty('--card-height', (380 * scale) + 'px');
    grid.dataset.compact = scale < 0.9 ? 'true' : 'false';
    document.getElementById('scale-value').innerText = Math.round(scale * 100) + '%';
}

// 9. 渲染单词本分类标签
function renderNotebookTabs() {
    const container = document.getElementById('notebook-tabs');
    const names = Object.keys(notebooks);
    
    container.innerHTML = names.map(name => {
        const isActive = name === activeNotebook;
        const activeStyle = "bg-emerald-800 dark:bg-teal-700 text-white shadow-sm font-semibold";
        const inactiveStyle = "bg-white dark:bg-stone-800 hover:bg-stone-100/80 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600";
        
        // 计算该本未掌握的生词
        const reviewCount = notebooks[name].filter(c => !c.mastered).length;

        return `
            <button onclick="switchNotebook('${name}')" class="px-4 py-1.5 rounded-full text-xs transition-colors duration-200 whitespace-nowrap ${isActive ? activeStyle : inactiveStyle}">
                ${name}
                <span class="ml-1 text-[10px] opacity-60">(${reviewCount})</span>
            </button>
        `;
    }).join('');
}

window.switchNotebook = function(name) {
    activeNotebook = name;
    activeTagFilters = []; // 切换分类时重置标签过滤
    saveData();
    renderNotebookTabs();
    renderCards();
}

// 10. 新建/删除分类模态框逻辑
window.openNewNotebookModal = function() {
    const modal = document.getElementById('new-notebook-modal');
    const input = document.getElementById('new-notebook-input');
    input.value = "";
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 150);
}

window.closeNewNotebookModal = function() {
    const modal = document.getElementById('new-notebook-modal');
    modal.classList.add('hidden');
}

window.submitNewNotebook = function() {
    const input = document.getElementById('new-notebook-input');
    const newName = input.value.trim();
    if (!newName) {
        showToast("名字不能为空哦");
        return;
    }
    if (notebooks[newName]) {
        showToast("该单词本名称已存在！");
        return;
    }

    notebooks[newName] = [];
    activeNotebook = newName;
    saveData();
    closeNewNotebookModal();
    renderNotebookTabs();
    renderCards();
    showToast(`单词本【${newName}】创建成功！`);
}

// ==========================================
// ✏️ 新增：重命名单词本功能
// ==========================================
window.openRenameNotebookModal = function() {
    const modal = document.getElementById('rename-notebook-modal');
    const input = document.getElementById('rename-notebook-input');
    const oldNameSpan = document.getElementById('rename-notebook-oldname');
    
    oldNameSpan.innerText = activeNotebook;
    input.value = activeNotebook; // 自动填入当前名字方便修改
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        input.focus();
        input.select(); // 全选文本，方便直接输入替换
    }, 150);
}

window.closeRenameNotebookModal = function() {
    const modal = document.getElementById('rename-notebook-modal');
    modal.classList.add('hidden');
}

window.submitRenameNotebook = function() {
    const input = document.getElementById('rename-notebook-input');
    const newName = input.value.trim();
    const oldName = activeNotebook;

    if (!newName) {
        showToast("新名字不能为空哦！");
        return;
    }
    if (newName === oldName) {
        closeRenameNotebookModal();
        return; // 名字没变，直接关闭
    }
    if (notebooks[newName]) {
        showToast("该单词本名称已存在，请换一个名字！");
        return;
    }

    // 安全的数据迁移：将旧名称下的数组直接赋给新名称，并删除旧名称
    notebooks[newName] = notebooks[oldName];
    delete notebooks[oldName];
    
    activeNotebook = newName; // 切换当前焦点到新单词本
    
    saveData();
    closeRenameNotebookModal();
    renderNotebookTabs();
    renderCards();
    showToast(`已成功将单词本重命名为【${newName}】`);
}


window.openDeleteNotebookConfirm = function() {
    const names = Object.keys(notebooks);
    if (names.length <= 1) {
        showToast("至少需要保留一个单词本！");
        return;
    }

    const modal = document.getElementById('delete-notebook-modal');
    const nameSpan = document.getElementById('delete-notebook-name');
    nameSpan.innerText = activeNotebook;
    modal.classList.remove('hidden');
}

window.closeDeleteNotebookConfirm = function() {
    const modal = document.getElementById('delete-notebook-modal');
    modal.classList.add('hidden');
}

window.submitDeleteNotebook = function() {
    const names = Object.keys(notebooks);
    const toDelete = activeNotebook;
    delete notebooks[toDelete];
    activeNotebook = Object.keys(notebooks)[0];
    
    saveData();
    closeDeleteNotebookConfirm();
    renderNotebookTabs();
    renderCards();
    showToast(`已永久删除单词本【${toDelete}】`);
}

// 📝 迷你列表模式下的手风琴点击展开折叠逻辑
window.toggleListExpand = function(element) {
    if (layoutMode !== "list") return;
    const expandedSection = element.querySelector('.list-expand-area');
    const arrowIcon = element.querySelector('.arrow-icon');
    if (expandedSection.classList.contains('hidden')) {
        expandedSection.classList.remove('hidden');
        arrowIcon.classList.add('rotate-180');
    } else {
        expandedSection.classList.add('hidden');
        arrowIcon.classList.remove('rotate-180');
    }
}

// 🌟 共享逻辑：计算当前界面实际展示的卡片集合（渲染与导出共用，保证“所见即所导”）
function getDisplayedCards() {
    const searchVal = document.getElementById('search-input').value;
    const searchTerms = getSearchTerms(searchVal);
    const isGlobalSearch = searchTerms.length > 0;
    // 全局范围：搜索或选中标签时，数据源扩展为全部单词本
    const isGlobalScope = isGlobalSearch || activeTagFilters.length > 0;
    const currentList = isGlobalScope
        ? Object.entries(notebooks).flatMap(([notebookName, cards]) => cards.map(card => ({ ...card, sourceNotebook: notebookName })))
        : (notebooks[activeNotebook] || []).map(card => ({ ...card, sourceNotebook: activeNotebook }));

    // 1. 过滤掌握状态（与搜索/标签正交组合，任何场景下都生效）
    let filteredList = currentList.filter(item => {
        if (cardFilter === "all") return true;
        if (cardFilter === "review") {
            return !item.mastered;
        } else {
            return item.mastered;
        }
    });

    // 1.5 过滤标签（多选交集：卡片需同时带所有选中的标签）
    if (activeTagFilters.length > 0) {
        filteredList = filteredList.filter(item =>
            item.tags && activeTagFilters.every(t => item.tags.includes(t))
        );
    }

    // 2. 过滤搜索关键词
    filteredList = filteredList.filter(item => matchesSearchTerms(item, searchTerms));
    return { filteredList, isGlobalSearch, isGlobalScope };
}

// 11. 核心渲染机制：动态组装单词卡片网格 (支持局部比例字号缩放及阻尼内部滚动)
function renderCards() {
    const grid = document.getElementById('cards-grid');
    const emptyState = document.getElementById('empty-state');
    const searchVal = document.getElementById('search-input').value;
    const renderContext = JSON.stringify([activeNotebook, cardFilter, layoutMode, activeTagFilters, normalizeSearchText(searchVal)]);
    if (renderContext !== lastCardRenderContext) {
        visibleCardLimit = cardsPerBatch;
        lastCardRenderContext = renderContext;
    }

    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    const totalCardCount = filteredList.length;
    const visibleCards = filteredList.slice(0, visibleCardLimit);

    // 3. 空状态展示
    if (filteredList.length === 0) {
        grid.innerHTML = '';
        updateLoadMoreControl(0);
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
        
        const titleEl = document.getElementById('empty-state-title');
        const subTitleEl = document.getElementById('empty-state-subtitle');
        if (activeTagFilters.length > 0) {
            titleEl.innerText = activeTagFilters.length > 1 ? "没有同时打上这些标签的单词" : "没有打上此标签的单词";
            subTitleEl.innerText = "当前筛选条件下没有匹配的单词，试试减少选中的标签，或把掌握状态切到「全部」。";
        } else if (isGlobalSearch) {
            titleEl.innerText = "没有找到匹配的单词";
            subTitleEl.innerText = "试试调整关键词，或检查当前的掌握状态与标签筛选条件。";
        } else if (cardFilter === "review") {
            titleEl.innerText = "当前分类没有未掌握单词";
            subTitleEl.innerText = "你太厉害了！本分类的单词已全部攻克，或者快去顶部添加一些生词吧。";
        } else if (cardFilter === "mastered") {
            titleEl.innerText = "还没有已掌握的单词";
            subTitleEl.innerText = "在复习时，点击卡片右上角的对勾(✓)按钮，即可把单词归档到此列表。";
        } else {
            titleEl.innerText = "当前分类还没有单词";
            subTitleEl.innerText = "快去顶部添加一些生词，开始你的单词积累吧。";
        }
        updateHeaderCount();
        return;
    } else {
        emptyState.classList.remove('flex');
        emptyState.classList.add('hidden');
    }

    // 根据布局模式切换网格类名，平铺用 3D Grid，列表采用单列平铺
    if (layoutMode === "grid") {
        grid.className = "adaptive-grid";
    } else {
        grid.className = "grid grid-cols-1 gap-3 max-w-2xl mx-auto";
    }

    // 4. 循环生成卡片元素
    grid.innerHTML = visibleCards.map(item => {
        const rubyBack = parseRubyText(item.word, item.kana);
        // 正面仅保留纯汉字，防止剧透假名
        const cleanWordFront = item.word.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');
        const sourceNotebook = item.sourceNotebook || activeNotebook;
        const notebookBadgeHtml = isGlobalScope
            ? `<span class="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium" style="font-size: var(--fs-tiny);">${sourceNotebook} · ${item.mastered ? '已掌握' : '复习中'}</span>`
            : '';

        // 已掌握按钮通用逻辑 (支持等比例Padding和高度)
        const masterButtonHtml = `
            <button onclick="toggleCardMastered(event, '${item.id}', '${sourceNotebook}')" class="${item.mastered ? 'text-emerald-600 dark:text-teal-400 hover:text-emerald-700 dark:hover:text-teal-300 bg-emerald-50 dark:bg-teal-900/30' : 'text-stone-300 dark:text-stone-600 hover:text-emerald-600 dark:hover:text-teal-400 hover:bg-emerald-50 dark:hover:bg-stone-700/50'} rounded-lg transition duration-150 shrink-0 flex items-center justify-center" style="padding: calc(0.375rem * var(--card-scale, 1.0));" title="${item.mastered ? '移回复习中' : '标记为已掌握'}">
                <svg class="w-4 h-4" style="width: calc(1rem * var(--card-scale, 1.0)); height: calc(1rem * var(--card-scale, 1.0));" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="${item.mastered ? '2.2' : '2.5'}" d="${item.mastered ? 'M10 19l-7-7m0 0l7-7m-7 7h18' : 'M5 13l4 4L19 7'}"></path>
                </svg>
            </button>
        `;

        // 编辑按钮通用逻辑
        const editButtonHtml = `
            <button onclick="openEditCardModal(event, '${item.id}', '${sourceNotebook}')" class="text-stone-300 dark:text-stone-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-stone-700/50 rounded-lg transition duration-150 shrink-0 flex items-center justify-center" style="padding: calc(0.375rem * var(--card-scale, 1.0));" title="修改卡片内容">
                <svg class="w-4 h-4" style="width: calc(1rem * var(--card-scale, 1.0)); height: calc(1rem * var(--card-scale, 1.0));" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            </button>
        `;

        // 🌟 分流：1. 平铺卡片视图
        // ⚠️ 重点防御：已彻底移除 card-inner、card-front 等核心 3D 容器的 transition-colors
        if (layoutMode === "grid") {
            let tagsHtml = '';
            if (item.tags && item.tags.length > 0) {
                // 灰绿低饱和标签：透明度压暗避免过绿；单行排列由背面顶栏内嵌容器控制
                tagsHtml = item.tags.map(tag => `<span class="px-1.5 py-0.5 bg-emerald-100/60 dark:bg-teal-900/25 text-emerald-800/75 dark:text-teal-300/80 rounded text-[10px] mr-1 border border-emerald-200/40 dark:border-teal-800/40 font-medium shrink-0">${tag}</span>`).join('');
            }

            return `
                <div class="perspective group cursor-pointer card-scale-box" data-has-example="${item.example ? 'true' : 'false'}" onclick="flipCard(this)">
                    <div class="card-inner relative w-full h-full rounded-2xl shadow-sm border border-stone-200/80 dark:border-stone-700/80 bg-white dark:bg-stone-800">
                        
                        <!-- 卡片正面 -->
                        <div class="card-front absolute inset-0 w-full h-full flex flex-col justify-between rounded-2xl bg-white dark:bg-stone-800 overflow-hidden" style="padding: var(--card-pad);">
                            <div class="flex justify-between items-center w-full shrink-0" style="margin-bottom: var(--spacing-gap);">
                                <div class="flex items-center gap-1.5 min-w-0">
                                    <span class="tracking-widest text-stone-300 dark:text-stone-600 font-mono font-bold" style="font-size: var(--fs-tiny);">FRONT</span>
                                    ${notebookBadgeHtml}
                                </div>
                                <div class="flex items-center space-x-1">
                                    ${editButtonHtml}
                                    ${masterButtonHtml}
                                </div>
                            </div>
                            
                            <div class="flex-1 min-h-0 flex items-center w-full">
                                <div class="card-content-scroll w-full max-h-full text-center">
                                    <h3 class="font-japanese font-medium tracking-wide text-stone-800 dark:text-stone-200 leading-normal break-words" lang="ja" style="font-size: var(--fs-title); overflow-wrap: anywhere; word-break: normal;">${cleanWordFront}</h3>
                                </div>
                            </div>
                            
                            <div class="text-center shrink-0" style="margin-top: var(--spacing-gap);">
                                <span class="text-emerald-800/60 dark:text-teal-600/80 group-hover:text-emerald-800 dark:group-hover:text-teal-500 duration-200 font-medium" style="font-size: var(--fs-small);">点击翻面 →</span>
                            </div>
                        </div>
                        
                        <!-- 卡片背面 (引入防溢出安全区域与局部柔和滚动阻尼) -->
                        <div class="card-back absolute inset-0 w-full h-full flex flex-col justify-between rounded-2xl bg-[#faf9f4] dark:bg-[#201d1c] border border-stone-200/50 dark:border-stone-700/50 overflow-hidden" style="padding: var(--card-pad);">
                            <div class="flex justify-between items-center w-full shrink-0" style="margin-bottom: var(--spacing-gap);">
                                <div class="flex items-center gap-1.5 min-w-0 shrink-0">
                                    <span class="tracking-widest text-emerald-800/40 dark:text-teal-600/40 font-mono font-bold flex items-center" style="font-size: var(--fs-tiny);">
                                        BACK
                                    </span>
                                    ${notebookBadgeHtml}
                                </div>
                                ${tagsHtml ? `<div class="tag-strip-inline flex-1 min-w-0 mx-1.5 overflow-hidden flex flex-nowrap items-center pointer-events-none">${tagsHtml}</div>` : ''}
                                <div class="flex items-center space-x-1 shrink-0">
                                    ${editButtonHtml}
                                    ${masterButtonHtml}
                                </div>
                            </div>

                            <!-- 主要内容区：卡片缩小时此区域自动自适应并拥有微型滚动条，绝不溢出被剪裁 -->
                            <div class="flex-grow w-full overflow-hidden relative">
                                <div class="card-content-scroll w-full h-full flex flex-col justify-start">
                                    <!-- 利用 margin: auto 0 让内容少时自动居中，内容多时靠顶对齐并可向下滚动，永不遮挡 -->
                                    <div class="w-full my-auto flex flex-col" style="gap: var(--spacing-gap);">
                                        <div class="text-center">
                                            <h3 class="font-japanese font-medium text-stone-900 dark:text-stone-100 leading-normal inline-block" lang="ja" style="font-size: var(--fs-sub);">${rubyBack}</h3>
                                        </div>
                                        <div class="text-center">
                                            <p class="text-stone-700 dark:text-stone-300 bg-stone-200/40 dark:bg-stone-700/50 rounded-lg inline-block max-w-full font-semibold" style="font-size: var(--fs-text); padding: calc(0.375rem * var(--card-scale, 1.0)) calc(0.75rem * var(--card-scale, 1.0));">${item.meaning}</p>
                                        </div>
                                        ${item.example ? formatExample(item.example) : ''}
                                    </div>
                                </div>
                            </div>

                            <div class="text-center shrink-0" style="margin-top: var(--spacing-gap);">
                                <span class="text-stone-400 dark:text-stone-600" style="font-size: var(--fs-tiny);">点击转回正面</span>
                            </div>
                        </div>

                    </div>
                </div>
            `;
        } else {
            // 🌟 分流：2. 📝 极简迷你列表模式 (手风琴折叠收纳)
            let tagsHtmlList = '';
            if (item.tags && item.tags.length > 0) {
                tagsHtmlList = item.tags.map(tag => `<span class="px-1.5 py-0.5 bg-emerald-100/60 dark:bg-teal-900/25 text-emerald-800/75 dark:text-teal-300/80 rounded text-[10px] mr-1 mb-1 border border-emerald-200/40 dark:border-teal-800/40 font-medium">${tag}</span>`).join('');
            }

            return `
                <div class="bg-white dark:bg-stone-800 border border-stone-200/80 dark:border-stone-700/80 rounded-xl shadow-sm hover:border-emerald-600/20 dark:hover:border-teal-600/30 transition-all duration-200 overflow-hidden cursor-pointer" onclick="toggleListExpand(this)">
                    <!-- 基础一览横条 -->
                    <div class="px-5 py-3.5 flex justify-between items-center bg-white dark:bg-stone-800 hover:bg-stone-50/50 dark:hover:bg-stone-800/80 transition-colors">
                        <div class="flex items-center space-x-3">
                            <span class="w-1.5 h-1.5 bg-emerald-800 dark:bg-teal-500 rounded-full transition-colors"></span>
                            <span class="font-japanese text-base font-semibold text-stone-800 dark:text-stone-200 tracking-wide transition-colors" lang="ja">${cleanWordFront}</span>
                            ${isGlobalScope ? `<span class="text-[10px] text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-md">${sourceNotebook} · ${item.mastered ? '已掌握' : '复习中'}</span>` : ''}
                        </div>
                        <div class="flex items-center space-x-2.5">
                            ${editButtonHtml}
                            ${masterButtonHtml}
                            <!-- 顺滑旋转折叠箭头 -->
                            <svg class="w-4 h-4 text-stone-400 dark:text-stone-500 transition-transform duration-300 transform arrow-icon shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path>
                            </svg>
                        </div>
                    </div>
                    
                    <!-- 展开区域 (假名标注、中文释义和例句) -->
                    <div class="list-expand-area hidden border-t border-stone-100 dark:border-stone-700/50 bg-[#faf9f4]/80 dark:bg-stone-800/50 px-6 py-4 space-y-4 transition-colors">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div class="flex items-center space-x-2">
                                <span class="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider shrink-0 transition-colors">假名读音:</span>
                                <span class="font-japanese font-medium text-stone-900 dark:text-stone-100 leading-normal inline-block transition-colors" lang="ja">${rubyBack}</span>
                            </div>
                            <div class="flex items-center space-x-2">
                                <span class="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider shrink-0 transition-colors">中文释义:</span>
                                <span class="text-stone-800 dark:text-stone-200 font-semibold px-2.5 py-1 bg-stone-200/40 dark:bg-stone-700/50 rounded-lg inline-block transition-colors">${item.meaning}</span>
                            </div>
                        </div>
                        ${item.example ? formatExample(item.example) : ''}
                        ${tagsHtmlList ? `<div class="pt-2 flex flex-wrap border-t border-stone-200/40 dark:border-stone-700/40">${tagsHtmlList}</div>` : ''}
                    </div>
                </div>
            `;
        }
    }).join('');

    updateLoadMoreControl(totalCardCount);
    updateHeaderCount();
}

function updateLoadMoreControl(totalCardCount) {
    const container = document.getElementById('load-more-container');
    const status = document.getElementById('load-more-status');
    const visibleCount = Math.min(visibleCardLimit, totalCardCount);
    if (totalCardCount <= visibleCardLimit) {
        container.classList.add('hidden');
        container.classList.remove('flex');
        return;
    }
    status.textContent = `已显示 ${visibleCount} / ${totalCardCount} 张卡片`;
    container.classList.remove('hidden');
    container.classList.add('flex');
}

window.loadMoreCards = function() {
    visibleCardLimit += cardsPerBatch;
    renderCards();
}

// Fixed card heights intentionally avoid runtime content measurement.
// 12. 点击翻牌
window.flipCard = function(element) {
    const inner = element.querySelector('.card-inner');
    inner.classList.toggle('is-flipped');
}

// 13. 编辑卡片功能区
let currentEditTags = [];

window.openEditCardModal = function(event, cardId, notebookName = activeNotebook) {
    event.stopPropagation(); // 防止翻牌和折叠
    
    const currentList = notebooks[notebookName] || [];
    const card = currentList.find(c => c.id === cardId);
    if (!card) return;

    document.getElementById('edit-card-id').value = card.id;
    document.getElementById('edit-card-notebook').value = notebookName;
    document.getElementById('edit-word').value = card.word;
    document.getElementById('edit-kana').value = card.kana;
    document.getElementById('edit-meaning').value = card.meaning;
    document.getElementById('edit-example').value = card.example || '';

    currentEditTags = [...(card.tags || [])];
    renderEditTags();
    document.getElementById('edit-tag-input').value = '';

    const targetSelect = document.getElementById('edit-move-target');
    const moveButton = document.getElementById('move-card-btn');
    const targets = Object.keys(notebooks).filter(name => name !== notebookName);
    targetSelect.innerHTML = targets.map(name => `<option value="${name}">${name}</option>`).join('');
    targetSelect.disabled = targets.length === 0;
    moveButton.disabled = targets.length === 0;

    const modal = document.getElementById('edit-card-modal');
    modal.classList.remove('hidden');
}

window.closeEditCardModal = function() {
    const modal = document.getElementById('edit-card-modal');
    modal.classList.add('hidden');
}

function renderEditTags() {
    const container = document.getElementById('edit-tags-container');
    container.innerHTML = currentEditTags.map((tag, index) => `
        <span class="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-teal-900/40 text-emerald-800 dark:text-teal-300 rounded text-xs font-medium border border-emerald-200/60 dark:border-teal-700/50">
            ${tag}
            <button type="button" onclick="removeEditTag(${index})" class="hover:text-emerald-950 dark:hover:text-teal-100 focus:outline-none ml-0.5">&times;</button>
        </span>
    `).join('');
    renderEditTagSuggestions();
}

// 渲染历史标签建议：全局收集所有单词本中已使用过的标签（排除当前卡片已有的），点击即添加
// 用 createElement + addEventListener 而非内联 onclick，标签含引号也不会出问题
function renderEditTagSuggestions() {
    const box = document.getElementById('edit-tag-suggestions');
    if (!box) return;
    const allTags = new Set();
    Object.values(notebooks).forEach(list => {
        (list || []).forEach(card => {
            (card.tags || []).forEach(tag => {
                if (tag && !currentEditTags.includes(tag)) allTags.add(tag);
            });
        });
    });
    box.innerHTML = '';
    if (allTags.size === 0) {
        box.classList.add('hidden');
        return;
    }
    box.classList.remove('hidden');
    const label = document.createElement('span');
    label.className = 'text-[10px] text-stone-400 dark:text-stone-500 self-center shrink-0';
    label.textContent = '历史标签：';
    box.appendChild(label);
    [...allTags].sort((a, b) => a.localeCompare(b, 'zh-CN')).forEach(tag => {
        const chip = document.createElement('button');
        chip.type = 'button';
        // 虚线描边 = 可点击添加；与已选中标签的实心蓝底形成形态区分，不会混淆
        chip.className = 'px-2 py-0.5 rounded-full text-[11px] font-medium bg-transparent text-emerald-900 dark:text-teal-300 border border-dashed border-emerald-600 dark:border-teal-500 hover:bg-emerald-100 dark:hover:bg-teal-900/30 hover:border-solid transition-colors';
        chip.textContent = '＋ ' + tag;
        chip.addEventListener('click', () => {
            if (!currentEditTags.includes(tag)) {
                currentEditTags.push(tag);
                renderEditTags(); // 会连带刷新建议列表（已添加的自动消失）
            }
        });
        box.appendChild(chip);
    });
}

window.removeEditTag = function(index) {
    currentEditTags.splice(index, 1);
    renderEditTags();
}

// 监听回车或逗号添加 Tag
document.getElementById('edit-tag-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault(); // 阻止表单默认提交
        const val = this.value.trim().replace(/^,+|,+$/g, ''); // 剔除多余逗号
        if (val && !currentEditTags.includes(val)) {
            currentEditTags.push(val);
            renderEditTags();
        }
        this.value = '';
    }
});

window.moveEditedCard = function() {
    const cardId = document.getElementById('edit-card-id').value;
    const sourceNotebook = document.getElementById('edit-card-notebook').value || activeNotebook;
    const targetNotebook = document.getElementById('edit-move-target').value;
    const sourceList = notebooks[sourceNotebook] || [];
    const cardIndex = sourceList.findIndex(card => card.id === cardId);
    if (cardIndex < 0 || !targetNotebook || !notebooks[targetNotebook]) return;

    const card = sourceList[cardIndex];
    const updatedWord = document.getElementById('edit-word').value.trim();
    if (hasGlobalDuplicate(updatedWord, card.id)) {
        showToast('全局单词库中已存在同一个单词，无法移动。');
        return;
    }

    card.word = updatedWord;
    card.kana = document.getElementById('edit-kana').value.trim();
    card.meaning = document.getElementById('edit-meaning').value.trim();
    card.example = document.getElementById('edit-example').value.trim();
    card.tags = [...currentEditTags]; // 移动时同样保留弹窗中编辑的标签
    sourceList.splice(cardIndex, 1);
    notebooks[targetNotebook].unshift(card);
    saveData();
    renderNotebookTabs();
    renderCards();
    closeEditCardModal();
    showToast(`已移动到【${targetNotebook}】单词本。`);
}

// 保存对卡片内容的修改
document.getElementById('edit-vocab-form').addEventListener('submit', function(e) {
    e.preventDefault();

    const cardId = document.getElementById('edit-card-id').value;
    const editNotebook = document.getElementById('edit-card-notebook').value || activeNotebook;
    const currentList = notebooks[editNotebook] || [];
    const card = currentList.find(c => c.id === cardId);

    if (card) {
        const updatedWord = document.getElementById('edit-word').value.trim();
        if (hasGlobalDuplicate(updatedWord, card.id)) {
            showToast('全局单词库中已存在同一个单词，无法保存。');
            return;
        }
        card.word = updatedWord;
        card.kana = document.getElementById('edit-kana').value.trim();
        card.meaning = document.getElementById('edit-meaning').value.trim();
        card.example = document.getElementById('edit-example').value.trim();
        card.tags = [...currentEditTags]; // 储存变更后的标签

        saveData();
        renderCards();
        closeEditCardModal();
        showToast("卡片内容及标签保存成功！");
    }
});

// 彻底从系统中删除本卡片
window.submitDeleteCardPermanently = function() {
    const cardId = document.getElementById('edit-card-id').value;
    const editNotebook = document.getElementById('edit-card-notebook').value || activeNotebook;
    const currentList = notebooks[editNotebook] || [];
    const cardIndex = currentList.findIndex(c => c.id === cardId);

    if (cardIndex > -1) {
        lastDeletedCard = {
            card: currentList[cardIndex],
            index: cardIndex,
            notebook: editNotebook
        };

        currentList.splice(cardIndex, 1);
        saveData();
        renderCards();
        renderNotebookTabs();
        closeEditCardModal();

        showToast("已从单词库彻底删除该卡片", () => {
            if (lastDeletedCard) {
                const targetList = notebooks[lastDeletedCard.notebook];
                targetList.splice(lastDeletedCard.index, 0, lastDeletedCard.card);
                saveData();
                renderCards();
                renderNotebookTabs();
                showToast("已成功撤销，卡片已恢复！");
                lastDeletedCard = null;
            }
        });
    }
}

// 14. 标记为“已掌握”或“撤回到复习”的逻辑
window.toggleCardMastered = function(event, cardId, notebookName = activeNotebook) {
    event.stopPropagation(); // 防止翻转与折叠

    const currentList = notebooks[notebookName] || [];
    const card = currentList.find(c => c.id === cardId);

    if (card) {
        const oldStatus = card.mastered;
        card.mastered = !card.mastered;
        saveData();
        renderCards();
        renderNotebookTabs();

        lastMasteredCardId = cardId;

        const statusMessage = oldStatus ? "已重新移回【复习中】单词册" : "已归档到【已掌握】归档库！";
        showToast(statusMessage, () => {
            const list = notebooks[notebookName] || [];
            const found = list.find(c => c.id === lastMasteredCardId);
            if (found) {
                found.mastered = oldStatus;
                saveData();
                renderCards();
                renderNotebookTabs();
                showToast("撤销操作成功！");
            }
        });
    }
}


// ==========================================
// ⚙️ 新增：AI 弹窗面板管理与持久化逻辑 (本地持久化，防明文外泄)
// ==========================================
window.openAiSettingsModal = function() {
    const modal = document.getElementById('ai-settings-modal');
    
    // 从内置沙盒加载已有配置并回显
    const provider = localStorage.getItem('ai_provider') || 'gemini';
    const geminiKey = localStorage.getItem('gemini_api_key') || '';
    const deepseekKey = localStorage.getItem('deepseek_api_key') || '';
    
    document.getElementById('gemini-key-input').value = geminiKey;
    document.getElementById('deepseek-key-input').value = deepseekKey;
    
    const toggles = document.getElementsByName('ai-provider-toggle');
    for (let t of toggles) {
        if (t.value === provider) {
            t.checked = true;
            break;
        }
    }
    
    modal.classList.remove('hidden');
}

window.closeAiSettingsModal = function() {
    document.getElementById('ai-settings-modal').classList.add('hidden');
}

window.saveAiSettings = function() {
    const geminiKey = document.getElementById('gemini-key-input').value.trim();
    const deepseekKey = document.getElementById('deepseek-key-input').value.trim();
    
    let selectedProvider = 'gemini';
    const toggles = document.getElementsByName('ai-provider-toggle');
    for (let t of toggles) {
        if (t.checked) {
            selectedProvider = t.value;
            break;
        }
    }
    
    // 数据封包存入 localStorage
    localStorage.setItem('ai_provider', selectedProvider);
    localStorage.setItem('gemini_api_key', geminiKey);
    localStorage.setItem('deepseek_api_key', deepseekKey);
    
    closeAiSettingsModal();
    showToast(`⚙️ AI服务商配置成功！当前激活：${selectedProvider === 'gemini' ? 'Google Gemini' : 'DeepSeek API'}`);
}

// ==========================================
// 📥 新增：AI 智能批量导入功能 (严格格式刷模式 + OCR多模态识别)
// ==========================================
let currentBatchImageBase64 = null;
let currentBatchImageMimeType = null;

// 处理用户选择的图片并转换为 Base64
window.handleBatchImageUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast("请上传合法的图片文件！");
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        const result = e.target.result;
        currentBatchImageBase64 = result.split(',')[1];
        currentBatchImageMimeType = file.type;
        document.getElementById('batch-image-preview').src = result;
        document.getElementById('batch-image-preview-container').classList.remove('hidden');
        document.getElementById('batch-import-textarea').placeholder = "✅ 图片已就绪。您可以将文本框留空，或者在此输入额外的约束补充说明...";
    };
    reader.readAsDataURL(file);
}

// 移除已选择的图片
window.clearBatchImage = function() {
    currentBatchImageBase64 = null;
    currentBatchImageMimeType = null;
    document.getElementById('batch-image-upload').value = '';
    document.getElementById('batch-image-preview-container').classList.add('hidden');
    document.getElementById('batch-import-textarea').placeholder = "例如粘贴内容：\n美味しい 好吃 (このケーキは美味しいです)\n勉強 べんきょう 学习\n...";
}

window.openBatchImportModal = function() {
    document.getElementById('batch-import-textarea').value = "";
    clearBatchImage();
    // 重置 JSON 导入栏
    document.getElementById('json-import-textarea').value = "";
    document.getElementById('json-file-upload').value = "";
    document.getElementById('json-import-preview').classList.add('hidden');
    document.getElementById('json-import-submit-btn').disabled = true;
    document.getElementById('json-new-notebook-name').value = "";
    document.querySelector('input[name="json-target"][value="current"]').checked = true;
    document.getElementById('json-target-current-name').innerText = activeNotebook;
    switchBatchTab('ai'); // 默认停留在 AI 栏
    document.getElementById('batch-import-modal').classList.remove('hidden');
}

window.closeBatchImportModal = function() {
    document.getElementById('batch-import-modal').classList.add('hidden');
}

// 栏位切换：AI 智能导入 / JSON 导入
window.switchBatchTab = function(tab) {
    const aiPane = document.getElementById('batch-pane-ai');
    const jsonPane = document.getElementById('batch-pane-json');
    const aiTab = document.getElementById('batch-tab-ai');
    const jsonTab = document.getElementById('batch-tab-json');
    const activeCls = ['bg-white', 'dark:bg-stone-700', 'text-purple-800', 'dark:text-purple-300', 'shadow-sm'];
    const inactiveCls = ['text-stone-500', 'dark:text-stone-400'];

    const showAi = (tab === 'ai');
    aiPane.classList.toggle('hidden', !showAi);
    aiPane.classList.toggle('flex', showAi);
    jsonPane.classList.toggle('hidden', showAi);
    jsonPane.classList.toggle('flex', !showAi);

    aiTab.classList.remove(...activeCls, ...inactiveCls);
    jsonTab.classList.remove(...activeCls, ...inactiveCls);
    aiTab.classList.add(...(showAi ? activeCls : inactiveCls));
    jsonTab.classList.add(...(showAi ? inactiveCls : activeCls));

    if (!showAi) {
        document.getElementById('json-target-current-name').innerText = activeNotebook;
    }
}

// 解析 JSON 内容：兼容三种格式——vocab-pack 单词包 / 云同步备份 {notebooks:{}} / 卡片数组
// 返回 { cards: [{word,kana,meaning,example,tags}], formatLabel, suggestedName }，失败时抛出异常
function parseVocabPack(text) {
    const data = JSON.parse(text); // 语法错误直接抛给调用方
    let rawCards = [];
    let formatLabel = "";
    let suggestedName = "";

    if (Array.isArray(data)) {
        rawCards = data;
        formatLabel = "卡片数组";
    } else if (data && data.format === "vocab-pack" && Array.isArray(data.cards)) {
        rawCards = data.cards;
        formatLabel = "单词包（vocab-pack）";
        suggestedName = String(data.scope || "").trim();
    } else if (data && data.notebooks && typeof data.notebooks === 'object') {
        formatLabel = "云同步备份（多单词本合并）";
        Object.keys(data.notebooks).forEach(name => {
            (data.notebooks[name] || []).forEach(c => rawCards.push(c));
        });
    } else {
        throw new Error("无法识别的 JSON 结构：既不是单词包，也不是云同步备份文件。");
    }

    // 统一清洗与校验：word 必填，其余字段兜底为空，tags 仅保留非空字符串
    const cards = [];
    rawCards.forEach(c => {
        if (!c || typeof c.word !== 'string' || !c.word.trim()) return;
        cards.push({
            word: c.word.trim(),
            kana: String(c.kana || "").trim(),
            meaning: String(c.meaning || "").trim(),
            example: String(c.example || "").trim(),
            tags: Array.isArray(c.tags) ? c.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : []
        });
    });
    if (cards.length === 0) {
        throw new Error("JSON 中没有找到任何有效单词条目。");
    }
    return { cards, formatLabel, suggestedName };
}

// 选择 JSON 文件后：读入文本框并触发解析预览
window.handleJsonFileUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('json-import-textarea').value = e.target.result;
        previewJsonImport();
    };
    reader.onerror = function() {
        showToast("文件读取失败，请重试。");
    };
    reader.readAsText(file, 'utf-8');
}

// 实时解析预览：成功则显示摘要并启用导入按钮，失败则静默隐藏
window.previewJsonImport = function() {
    const preview = document.getElementById('json-import-preview');
    const submitBtn = document.getElementById('json-import-submit-btn');
    const text = document.getElementById('json-import-textarea').value.trim();
    if (!text) {
        preview.classList.add('hidden');
        submitBtn.disabled = true;
        return;
    }
    try {
        const parsed = parseVocabPack(text);
        const sample = parsed.cards.slice(0, 3).map(c => getCleanWordText(c.word)).join('、');
        preview.innerHTML = `✅ 识别为 <strong>${parsed.formatLabel}</strong>，共 <strong>${parsed.cards.length}</strong> 个单词：${sample}${parsed.cards.length > 3 ? ' …' : ''}`;
        preview.classList.remove('hidden');
        submitBtn.disabled = false;
        // 词包带有范围名时，预填新单词本名称（不覆盖用户已输入的内容）
        const nameInput = document.getElementById('json-new-notebook-name');
        if (parsed.suggestedName && !nameInput.value.trim()) {
            nameInput.value = parsed.suggestedName;
        }
    } catch (e) {
        preview.classList.add('hidden');
        submitBtn.disabled = true;
    }
}

// 执行 JSON 导入：按去向（当前单词本 / 新建单词本）合并，按词形去重，id 重新生成
window.submitJsonImport = function() {
    const text = document.getElementById('json-import-textarea').value.trim();
    if (!text) {
        showToast("请先选择或粘贴 JSON 内容！");
        return;
    }
    let parsed;
    try {
        parsed = parseVocabPack(text);
    } catch (e) {
        showToast(`❌ JSON 解析失败：${e.message}`);
        return;
    }

    const targetMode = document.querySelector('input[name="json-target"]:checked').value;
    let targetName;
    if (targetMode === 'new') {
        targetName = document.getElementById('json-new-notebook-name').value.trim();
        if (!targetName) {
            showToast("请填写新单词本的名称！");
            return;
        }
        // 撞名自动加后缀，绝不覆盖已有单词本
        if (notebooks[targetName]) {
            let i = 2;
            while (notebooks[`${targetName} (${i})`]) i++;
            targetName = `${targetName} (${i})`;
        }
        notebooks[targetName] = [];
    } else {
        targetName = activeNotebook;
        if (!notebooks[targetName]) notebooks[targetName] = [];
    }

    const targetList = notebooks[targetName];
    const getCleanWord = (w) => w.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');
    let successCount = 0;
    let dupCount = 0;

    parsed.cards.forEach(c => {
        const cleanInputWord = getCleanWord(c.word);
        const isDuplicate = targetList.some(card => getCleanWord(card.word) === cleanInputWord);
        if (isDuplicate) {
            dupCount++;
        } else {
            targetList.push({
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                word: c.word,
                kana: c.kana,
                meaning: c.meaning,
                example: c.example,
                tags: c.tags,
                mastered: false
            });
            successCount++;
        }
    });

    saveData();
    renderNotebookTabs();
    if (targetMode === 'new') {
        switchNotebook(targetName); // 自动切到新本子，立刻看到成果
    } else {
        renderCards();
        updateHeaderCount();
    }
    closeBatchImportModal();

    if (dupCount > 0) {
        showToast(`📦 导入完成！新增 ${successCount} 个单词到「${targetName}」，自动跳过 ${dupCount} 个重复词。`);
    } else {
        showToast(`📦 导入完成！${successCount} 个单词已加入「${targetName}」。`);
    }
}

window.submitBatchImport = async function() {
    const textArea = document.getElementById('batch-import-textarea');
    const textVal = textArea.value.trim();
    if (!textVal && !currentBatchImageBase64) {
        showToast("请先粘贴文本内容，或上传一张包含日语笔记的图片！");
        return;
    }

    const activeProvider = localStorage.getItem('ai_provider') || 'gemini';
    
    // 安全阻断：DeepSeek API 目前原生不支持直接通过同一套接口无缝传入图片，强制指引使用具备多模态的 Gemini
    if (currentBatchImageBase64 && activeProvider !== 'gemini') {
        showToast("⚠️ 笔记的手写照片识别目前仅支持 Google Gemini！请先在右上角【⚙️ AI设置】中切换服务商。");
        return;
    }

    const geminiKey = localStorage.getItem('gemini_api_key') || '';
    const deepseekKey = localStorage.getItem('deepseek_api_key') || '';
    const currentToken = activeProvider === 'gemini' ? geminiKey : deepseekKey;

    if (!currentToken) {
        showToast(`⚠️ 请先点击右上角“⚙️ AI设置”配置您的密钥！`);
        openAiSettingsModal();
        closeBatchImportModal();
        return;
    }

    const btn = document.getElementById('batch-import-submit-btn');
    const btnSpinner = document.getElementById('batch-import-spinner');
    const btnText = document.getElementById('batch-import-btn-text');

    btn.disabled = true;
    btnSpinner.classList.remove('hidden');
    btnText.innerText = "视觉提取处理中...";

    // 严格设定 System Prompt，强迫 AI 仅仅扮演“格式化工具”的角色，绝不自动补充假名
    const systemPrompt = `你是一个非常严谨的文本结构化工具。
任务：从用户给定的杂乱笔记文本或【上传的手写/印刷图片】中，提取出所有日语单词条目，并转换为 JSON 格式。
【绝对规则，不可违背】
1. 只能提取原文或图片中已有的信息。绝对不要自行翻译、编造或补充缺失的假名、中文释义和例句！
2. 如果原文中某个词没有提供假名、释义或例句，其对应的 JSON 字段必须直接留空字符串 ""。
3. 如果原文包含例句，请将其提取到 example 字段。
4. 必须输出纯净合法的 JSON 对象，禁止使用 Markdown 标记包裹。
【输出格式】
必须严格返回如下格式的 JSON 对象（不可有其他外层属性）：
{
  "items": [
    {
      "word": "提取的日文汉字或单词（必填）",
      "kana": "提取的假名（若原文无，留空）",
      "meaning": "提取的中文释义（若原文无，留空）",
      "example": "提取的例句（若原文无，留空）"
    }
  ]
}`;

    try {
        let url = "";
        let fetchOptions = {};

        if (activeProvider === 'gemini') {
            const model = "gemini-2.5-flash";
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentToken}`;
            
            // 构建支持多模态（图+文混合）的载荷 Parts
            const promptText = systemPrompt + "\n\n要处理的内容说明：\n" + (textVal || "请精准识别随附图片中的日语内容并提取。");
            const payloadParts = [{ text: promptText }];
            
            // 如果存在图片，把图片 Base64 数据原封不动塞进 InlineData 送给模型
            if (currentBatchImageBase64) {
                payloadParts.push({
                    inlineData: {
                        mimeType: currentBatchImageMimeType,
                        data: currentBatchImageBase64
                    }
                });
            }

            fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: payloadParts }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                items: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            word: { type: "STRING" },
                                            kana: { type: "STRING" },
                                            meaning: { type: "STRING" },
                                            example: { type: "STRING" }
                                        },
                                        required: ["word", "kana", "meaning", "example"]
                                    }
                                }
                            },
                            required: ["items"]
                        }
                    }
                })
            };
        } else {
            url = "https://api.deepseek.com/chat/completions";
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({
                    model: "deepseek-v4-flash",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `请提取以下文本，严格按含 items 字段的 JSON 对象返回。文本：\n${textVal}` }
                    ],
                    response_format: { type: "json_object" },
                    stream: false
                })
            };
        }

        const responseData = await fetchWithBackoff(url, fetchOptions);
        let textJson = "";

        if (activeProvider === 'gemini') {
            textJson = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
            textJson = responseData.choices?.[0]?.message?.content;
        }

        if (textJson) {
            textJson = textJson.replace(/```json/ig, '').replace(/```/g, '').trim();
        }
        if (!textJson) throw new Error("AI未能输出合法结果");

        const parsedData = JSON.parse(textJson);
        const itemsList = parsedData.items || [];

        if (!Array.isArray(itemsList) || itemsList.length === 0) {
            throw new Error("未能从图片或文本中提取到任何有效单词。");
        }

        // 批量执行查重与导入
        if (!notebooks[activeNotebook]) notebooks[activeNotebook] = [];
        let successCount = 0;
        let dupCount = 0;

        const getCleanWord = (w) => w.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');

        // 翻转数组以保证导入顺序符合用户从上到下的阅读习惯
        itemsList.reverse().forEach(item => {
            if(!item.word) return;
            const cleanInputWord = getCleanWord(item.word.trim());
            const isDuplicate = notebooks[activeNotebook].some(card => getCleanWord(card.word) === cleanInputWord);
            
            if (isDuplicate) {
                dupCount++;
            } else {
                notebooks[activeNotebook].unshift({
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    word: item.word.trim(),
                    kana: (item.kana || "").trim(),
                    meaning: (item.meaning || "").trim(),
                    example: (item.example || "").trim(),
                    mastered: false
                });
                successCount++;
            }
        });

        saveData();
        renderCards();
        renderNotebookTabs();
        closeBatchImportModal();

        if (dupCount > 0) {
            showToast(`✨ 提取完毕！成功提取 ${successCount} 个新词，自动跳过了 ${dupCount} 个库内重复词。`);
        } else {
            showToast(`✨ 提取成功！从图片/笔记中为您制作了 ${successCount} 张新卡片。`);
        }

    } catch (error) {
        console.error(error);
        showToast(`❌ 提取失败: ${error.message}`);
    } finally {
        btn.disabled = false;
        btnSpinner.classList.add('hidden');
        btnText.innerText = "✨ 提取并生成卡片";
    }
}


// ==========================================
// ✨ 改动：全新重构的智能多通道假名自适应匹配模块 (兼容 Gemini 与 DeepSeek 两种网络接口)
// ==========================================
async function fetchWithBackoff(url, options, retries = 5, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return await response.json();
            }
            throw new Error(`API 返回错误代码: ${response.status}`);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
}

window.autoLookupWord = async function(isEdit = false) {
    const wordInputId = isEdit ? 'edit-word' : 'input-word';
    const wordVal = document.getElementById(wordInputId).value.trim();
    
    if (!wordVal) {
        showToast("请先输入需要匹配的日语单词。");
        return;
    }

    // 1. 读取本地非明文密钥配置
    const activeProvider = localStorage.getItem('ai_provider') || 'gemini';
    const geminiKey = localStorage.getItem('gemini_api_key') || '';
    const deepseekKey = localStorage.getItem('deepseek_api_key') || '';
    
    const currentToken = activeProvider === 'gemini' ? geminiKey : deepseekKey;

    if (!currentToken) {
        showToast(`⚠️ 请先点击右上角“⚙️ AI设置”配置您的 ${activeProvider === 'gemini' ? 'Gemini' : 'DeepSeek'} 密钥！`);
        openAiSettingsModal();
        return;
    }

    const btnTextId = isEdit ? 'edit-ai-btn-text' : 'ai-btn-text';
    const btnSpinnerId = isEdit ? 'edit-ai-btn-spinner' : 'ai-btn-spinner';
    const btnId = isEdit ? 'edit-ai-parse-btn' : 'ai-parse-btn';

    const btnText = document.getElementById(btnTextId);
    const btnSpinner = document.getElementById(btnSpinnerId);
    const btn = document.getElementById(btnId);

    btn.disabled = true;
    btnSpinner.classList.remove('hidden');
    btnText.innerText = "匹配中...";

    // 严苛的核心 System Prompt
    const systemPrompt = `你是一个非常专业且极致克制的日语研究助手。
任务：接收用户输入的日语词汇，仅仅生成读音平假名，以及带汉字振假名括号的对齐文本。
注意：不要尝试生成例句、不要生成中文解释。必须返回一个纯净的 JSON 字符串（不要有任何 Markdown \`\`\`json 包裹）。
要求：
1. 生成精准的“振假名括号对齐文本” (word_with_bracket) 中括号[ ]里的假名必须只标注在对应的日文汉字上，绝对不能黏连周围的平假名。
   - 示例: 输入 '日本語'，返回 '日本[にほん]語[ご]'。
   - 示例: 输入 '食べる'，返回 '食[た]べる' (假名 'べ' 和 'る' 不能塞进括号中)。
   - 示例: 输入 '美味しい'，返回 '美[お]味[い]しい'。
必须严格返回如下 JSON 格式：{"kana": "纯假名", "word_with_bracket": "带括号格式"}`;

    try {
        let url = "";
        let fetchOptions = {};

        if (activeProvider === 'gemini') {
            // 修复版：采用最基础、兼容性最强的 Gemini 请求格式
            const model = "gemini-2.5-flash";
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentToken}`;
            fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ 
                        parts: [{ text: systemPrompt + "\n\n目标词汇：" + wordVal }] 
                    }]
                })
            };
        } else {
            // 付费级通用 DeepSeek 模型通用请求管道
            url = "https://api.deepseek.com/chat/completions";
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({
                    model: "deepseek-v4-flash",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `请解析以下日语词汇，以标准 JSON 返回字段 'kana' 和 'word_with_bracket'。目标词汇：${wordVal}` }
                    ],
                    response_format: { type: "json_object" },
                    stream: false
                })
            };
        }

        const responseData = await fetchWithBackoff(url, fetchOptions);
        let textJson = "";

        if (activeProvider === 'gemini') {
            textJson = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
            // 由于降级为普通文本请求，Gemini 有时会顽固地加上 Markdown 代码块包裹，需要手动剥离
            if (textJson) {
                 textJson = textJson.replace(/```json/g, '').replace(/```/g, '').trim();
            }
        } else {
            textJson = responseData.choices?.[0]?.message?.content;
        }

        if (!textJson) throw new Error("AI未能输出合法的回包字段");

        const data = JSON.parse(textJson);

        // 填入解耦后的文本框
        if (isEdit) {
            document.getElementById('edit-word').value = data.word_with_bracket;
            document.getElementById('edit-kana').value = data.kana;
        } else {
            document.getElementById('input-word').value = data.word_with_bracket;
            document.getElementById('input-kana').value = data.kana;
        }

        showToast(`✨ 使用 ${activeProvider === 'gemini' ? 'Gemini' : 'DeepSeek'} 智能适配完成！`);
    } catch (error) {
        console.error(error);
        showToast("匹配出现问题，请确认密钥、用量或网络环境。");
    } finally {
        btn.disabled = false;
        btnSpinner.classList.add('hidden');
        btnText.innerText = "匹配假名";
    }
}


// ==========================================
// 💾 IndexedDB 离线词典核心存取逻辑
// ==========================================
function initIndexedDB() {
    const request = indexedDB.open("OfflineDictDB", 1);
    
    request.onerror = function() {
        document.getElementById('dict-db-status').innerHTML = "⚠️ 本地数据库加载失败";
    };
    
    request.onsuccess = function(e) {
        db = e.target.result;
        checkDictionaryEmpty();
    };
    
    request.onupgradeneeded = function(e) {
        const activeDb = e.target.result;
        const store = activeDb.createObjectStore("dictionary", { keyPath: "word" });
        store.createIndex("kana", "kana", { unique: false });
        store.createIndex("meaning", "meaning", { unique: false });
    };
}

function checkDictionaryEmpty() {
    const tx = db.transaction("dictionary", "readonly");
    const store = tx.objectStore("dictionary");
    const countRequest = store.count();
    
    countRequest.onsuccess = function() {
        if (countRequest.result === 0) {
            importDictionaryData(preloadedDictionary, true);
        } else {
            updateDictStatusLabel(countRequest.result);
        }
    };
}

function updateDictStatusLabel(count) {
    const label = document.getElementById('dict-db-status');
    label.innerHTML = `🟢 已加载 ${count} 个本地核心词`;
}

function importDictionaryData(dataArray, silent = false) {
    const tx = db.transaction("dictionary", "readwrite");
    const store = tx.objectStore("dictionary");
    
    let successCount = 0;
    dataArray.forEach(item => {
        if (item.word && (item.kana || item.meaning)) {
            store.put({
                word: item.word.trim(),
                kana: (item.kana || "").trim(),
                meaning: (item.meaning || "").trim()
            });
            successCount++;
        }
    });
    
    tx.oncomplete = function() {
        const countTx = db.transaction("dictionary", "readonly");
        const countStore = countTx.objectStore("dictionary");
        const req = countStore.count();
        req.onsuccess = function() {
            updateDictStatusLabel(req.result);
        };
    };
}

window.searchDictionary = function() {
    const searchVal = document.getElementById('dict-search-input').value.trim().toLowerCase();
    const resultsBox = document.getElementById('dict-results');
    
    if (!searchVal) {
        resultsBox.innerHTML = '';
        resultsBox.classList.add('hidden');
        return;
    }

    const tx = db.transaction("dictionary", "readonly");
    const store = tx.objectStore("dictionary");
    const cursorRequest = store.openCursor();
    
    let matched = [];
    
    cursorRequest.onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) {
            const item = cursor.value;
            const w = item.word.toLowerCase();
            const k = item.kana.toLowerCase();
            const m = item.meaning.toLowerCase();
            
            if (w.includes(searchVal) || k.includes(searchVal) || m.includes(searchVal)) {
                matched.push(item);
            }
            
            if (matched.length < 20) {
                cursor.continue();
            } else {
                renderDictResults(matched);
            }
        } else {
            renderDictResults(matched);
        }
    };
}

function renderDictResults(results) {
    const resultsBox = document.getElementById('dict-results');
    resultsBox.classList.remove('hidden');
    
    if (results.length === 0) {
        resultsBox.innerHTML = `
            <div class="p-3 text-center text-xs text-stone-400 bg-stone-50 dark:bg-stone-900 rounded-xl border border-dashed border-stone-200 dark:border-stone-700 transition-colors">
                未在本地离线词典中检索到该词。试用下方“网页词典”联查吧
            </div>
        `;
        return;
    }

    resultsBox.innerHTML = results.map(item => {
        return `
            <div onclick="fillFromDictionary('${item.word}', '${item.kana}', '${item.meaning}')" class="p-3 bg-stone-50 dark:bg-stone-800 hover:bg-amber-500/5 dark:hover:bg-stone-700 border border-stone-200/80 dark:border-stone-700 hover:border-amber-500/30 dark:hover:border-stone-600 rounded-xl cursor-pointer transition-colors text-left group">
                <div class="flex justify-between items-start">
                    <span class="font-japanese text-sm font-semibold text-stone-800 dark:text-stone-200 group-hover:text-amber-900 dark:group-hover:text-amber-500 transition-colors" lang="ja">${item.word}</span>
                    <span class="font-japanese text-[11px] text-stone-400 dark:text-stone-500 transition-colors" lang="ja">${item.kana}</span>
                </div>
                <p class="text-xs text-stone-500 dark:text-stone-400 mt-1 truncate transition-colors">${item.meaning}</p>
            </div>
        `;
    }).join('');
}

window.fillFromDictionary = function(word, kana, meaning) {
    document.getElementById('input-word').value = word;
    document.getElementById('input-kana').value = kana;
    document.getElementById('input-meaning').value = meaning;
    
    document.getElementById('input-word').focus();
    showToast("已为你将词典结果一键填入上方添加表单！");
}

window.openExternalSearch = function(site) {
    const query = document.getElementById('dict-search-input').value.trim() || document.getElementById('input-word').value.trim();
    if (!query) {
        showToast("请先在上方输入框中写下查询的单词本体！");
        return;
    }
    const cleanQuery = query.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');

    let url = "";
    if (site === 'kotobank') {
        url = `https://kotobank.jp/word/${encodeURIComponent(cleanQuery)}`;
    } else if (site === 'weblio_cjjc') {
        url = `https://cjjc.weblio.jp/content/${encodeURIComponent(cleanQuery)}`;
    } else if (site === 'weblio_ruigo') {
        url = `https://thesaurus.weblio.jp/content/${encodeURIComponent(cleanQuery)}`;
    }

    window.open(url, '_blank');
}

window.toggleDictionaryDrawer = function() {
    const drawer = document.getElementById('dict-drawer');
    if (drawer.classList.contains('hidden')) {
        drawer.classList.remove('hidden');
        setTimeout(() => {
            drawer.classList.remove('translate-x-full');
        }, 50);
    } else {
        drawer.classList.add('translate-x-full');
        setTimeout(() => {
            drawer.classList.add('hidden');
        }, 300);
    }
}


// ==========================================
// ☁️ 核心：GitHub Gist 轻量云同步功能
// ==========================================
window.openCloudSyncModal = function() {
    const drawer = document.getElementById('cloud-drawer');
    if (drawer.classList.contains('hidden')) {
        drawer.classList.remove('hidden');
        setTimeout(() => {
            drawer.classList.remove('translate-x-full');
        }, 50);
    }
}

window.closeCloudSyncModal = function() {
    const drawer = document.getElementById('cloud-drawer');
    drawer.classList.add('translate-x-full');
    setTimeout(() => {
        drawer.classList.add('hidden');
    }, 300);
}

function updateSyncStatus(msg, isError = false) {
    const statusEl = document.getElementById('sync-status');
    statusEl.innerText = msg;
    statusEl.className = `text-center text-xs font-semibold py-2 ${isError ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-teal-500'}`;
}

window.syncToCloud = async function() {
    const token = document.getElementById('gist-token').value.trim();
    let gistId = document.getElementById('gist-id').value.trim();
    const btn = document.getElementById('btn-sync-up');

    if (!token) {
        updateSyncStatus("❌ 错误：请先输入您的 GitHub Token", true);
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-2">🌀</span>正在加密打包上传...`;
    updateSyncStatus("📡 正在连接 GitHub 服务器...");

    const payloadContent = JSON.stringify({
        version: "1.0",
        lastSync: new Date().toISOString(),
        notebooks: notebooks
    }, null, 2);

    const payload = {
        description: "Japanese Vocabulary App Backup",
        public: false,
        files: {
            "japanese_vocab_backup.json": {
                content: payloadContent
            }
        }
    };

    try {
        let url = 'https://api.github.com/gists';
        let method = 'POST';

        if (gistId) {
            url = `https://api.github.com/gists/${gistId}`;
            method = 'PATCH';
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            if (response.status === 404) throw new Error("Gist ID 不存在或 Token 无读写权限");
            if (response.status === 401) throw new Error("Token 验证失败，请检查是否填错");
            throw new Error(`请求失败 (状态码: ${response.status})`);
        }

        const data = await response.json();
        
        if (!gistId) {
            document.getElementById('gist-id').value = data.id;
            gistId = data.id;
        }

        localStorage.setItem('gist_token', token);
        localStorage.setItem('gist_id', gistId);

        updateSyncStatus(`✅ 同步成功！(云端房间号: ${gistId})`);
        showToast("🎉 数据已安全覆盖并上传至 GitHub 云端！");

    } catch (err) {
        updateSyncStatus(`❌ 上传失败: ${err.message}`, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg><span> ⬆️ 上传并覆盖至云端</span>`;
    }
}

window.syncFromCloud = async function() {
    const token = document.getElementById('gist-token').value.trim();
    const gistId = document.getElementById('gist-id').value.trim();
    const btn = document.getElementById('btn-sync-down');

    if (!token || !gistId) {
        updateSyncStatus("❌ 错误：从云端拉取必须同时提供 Token 和 专属 Gist ID", true);
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin mr-2">🌀</span>正在拉取云端数据...`;
    updateSyncStatus("📡 正在访问 GitHub 服务器...");

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 404) throw new Error("找不到该 Gist，请检查 ID 是否正确");
            if (response.status === 401) throw new Error("Token 验证失败");
            throw new Error(`请求失败 (状态码: ${response.status})`);
        }

        const data = await response.json();
        
        const fileObj = data.files["japanese_vocab_backup.json"];
        if (!fileObj || !fileObj.content) {
            throw new Error("在您的 Gist 房间里找不到备份数据文件");
        }

        const parsedData = JSON.parse(fileObj.content);
        
        if (parsedData.notebooks) {
            notebooks = parsedData.notebooks;
            if (!notebooks[activeNotebook]) {
                activeNotebook = Object.keys(notebooks)[0] || "日常";
            }
            saveData();
            renderNotebookTabs();
            renderCards();

            localStorage.setItem('gist_token', token);
            localStorage.setItem('gist_id', gistId);

            updateSyncStatus(`✅ 数据恢复成功！(最后云端同步时间: ${new Date(parsedData.lastSync).toLocaleString()})`);
            showToast("🎉 数据已从云端拉取，本地卡片库已全面更新！");
        } else {
            throw new Error("云端数据格式不合法，无法解析");
        }

    } catch (err) {
        updateSyncStatus(`❌ 拉取失败: ${err.message}`, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4-4m4 4V4"></path></svg><span>⬇️ 从云端拉取并恢复本地</span>`;
    }
}


// ==========================================
// 🚨 查重与提交：添加生词主表单提交
// ==========================================
document.getElementById('vocab-form').addEventListener('submit', function(e) {
    e.preventDefault(); // 阻止浏览器默认的刷新动作
    
    const wordInput = document.getElementById('input-word');
    const kanaInput = document.getElementById('input-kana');
    const meaningInput = document.getElementById('input-meaning');
    const exampleInput = document.getElementById('input-example');
    
    const wordVal = wordInput.value.trim();

    if (!notebooks[activeNotebook]) {
        notebooks[activeNotebook] = [];
    }

    // --- 智能防重复检查逻辑 ---
    const getCleanWord = (w) => w.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');
    const cleanInputWord = getCleanWord(wordVal);
    
    const isDuplicate = notebooks[activeNotebook].some(card => getCleanWord(card.word) === cleanInputWord);
    
    if (isDuplicate) {
        showToast(`⚠️ “${cleanInputWord}” 已存在于本册中，请勿重复添加！`);
        wordInput.select(); 
        return; 
    }

    const newVocab = {
        id: Date.now().toString(),
        word: wordVal,
        kana: kanaInput.value.trim(),
        meaning: meaningInput.value.trim(),
        example: exampleInput.value.trim(),
        mastered: false,
        tags: [] // 初始新卡片无标签，需在编辑面板添加
    };

    notebooks[activeNotebook].unshift(newVocab);
    saveData();
    
    if (cardFilter !== "review") {
        setCardFilter("review");
    } else {
        renderCards();
    }
    renderNotebookTabs();

    e.target.reset(); 
    wordInput.focus();

    showToast("成功添加词卡到当前单词本！");
});

// Delay repeated redraws while typing; clearing the search stays immediate.
// 搜索是一个"模式"：进入时过滤器归零一次（掌握状态跳「全部」、标签清空）；
// 搜索中调整过滤器完全自由；清空搜索框时退出模式，恢复默认视图（复习中）。
document.getElementById('search-input').addEventListener('input', function(event) {
    window.clearTimeout(searchDebounceTimer);
    const isSearching = event.target.value.trim() !== '';
    const wasSearching = this.dataset.wasSearching === '1';

    if (isSearching && !wasSearching) {
        // 空 → 非空：进入搜索模式，过滤器归零一次（之后不再插手）
        activeTagFilters = [];
        renderGlobalTags();
        setCardFilter("all");
    } else if (!isSearching && wasSearching) {
        // 非空 → 空：退出搜索模式，回到默认浏览视图
        activeTagFilters = [];
        renderGlobalTags();
        setCardFilter("review");
    }
    this.dataset.wasSearching = isSearching ? '1' : '0';

    if (!isSearching) {
        renderCards();
        return;
    }
    searchDebounceTimer = window.setTimeout(renderCards, 120);
});

// 一键翻面
let allFlipped = false;
document.getElementById('toggle-all-btn').addEventListener('click', () => {
    if (layoutMode !== "grid") {
        showToast("一键全部翻转功能只支持【卡片平铺】模式哦！");
        return;
    }
    const cardInners = document.querySelectorAll('.card-inner');
    allFlipped = !allFlipped;
    cardInners.forEach(card => {
        if (allFlipped) {
            card.classList.add('is-flipped');
        } else {
            card.classList.remove('is-flipped');
        }
    });
    
    const btnSpan = document.querySelector('#toggle-all-btn span');
    btnSpan.innerText = allFlipped ? "还原正面" : "全卡翻面";
});

// 一键随机打乱当前单词本的卡片显示顺序
window.shuffleCards = function() {
    const currentList = notebooks[activeNotebook] || [];
    if (currentList.length <= 1) {
        showToast("当前本里只有一个单词，不用打乱哦！");
        return;
    }

    for (let i = currentList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentList[i], currentList[j]] = [currentList[j], currentList[i]];
    }

    saveData();
    renderCards();
    showToast("顺序已打乱！快开始新一轮复习吧 🎲");
}


// 17. 💾 一键生成并导出格式精美、兼容极佳的 A4 结构 Markdown 练习表
// 🌟 “所见即所导”：导出当前界面实际展示的单词（跟随搜索、复习/已掌握、标签等全部筛选条件）
window.exportToMD = function() {
    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    if (filteredList.length === 0) {
        showToast("当前界面没有可以导出的单词！");
        return;
    }

    const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

    // 组装导出范围名称（用于标题、文件名）
    let scopeName = activeNotebook;
    if (isGlobalScope) {
        const parts = [];
        if (activeTagFilters.length > 0) parts.push(`标签·${activeTagFilters.join("·")}`);
        if (isGlobalSearch) parts.push("搜索结果");
        scopeName = parts.join("·");
    }
    const safeScopeName = scopeName.replace(/[\\\/:*?"<>|]/g, '_'); // 清洗文件名非法字符

    // 🛡️ 表格单元格清洗：防止真实换行打断 Markdown 表格行、剔除控制字符与损坏的 Unicode 孤立代理项
    const sanitizeMdCell = (text) => String(text || '')
        .replace(/\r\n|\r|\n/g, ' ')          // 换行会截断表格行，转为空格（表格内本就用 <br> 换行）
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '') // 不可见控制字符
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '') // 孤立的高位代理项（损坏字符，会变 �）
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''); // 孤立的低位代理项

    let mdContent = `# 📓 日语单词自测练习表 (${scopeName})\n\n`;
    mdContent += `- **导出范围**: ${scopeName}${isGlobalScope ? '（跨单词本）' : ''}\n`;
    mdContent += `- **导出日期**: ${dateStr}\n`;
    mdContent += `- **生词总数**: ${filteredList.length} 词\n\n`;
    mdContent += `---\n\n`;
    mdContent += `> **💡 背诵建议**：你可以直接将此文件导入 Obsidian、Notion 或任何支持 Markdown 的编辑器中进行背诵复习，也可以直接在笔记软件中将其输出为 PDF 打印成纸质版。最右侧的 [ 默写与自测备注栏 ] 保持空白，专门留给你进行手写自测和错词标记。\n\n`;
    mdContent += `| 单词与假名 | 中文释义与例句 | 默写/自测备注栏 |\n`;
    mdContent += `| :--- | :--- | :--- |\n`;

    filteredList.forEach(item => {
        let cleanWord = sanitizeMdCell(item.word).replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // 使用标准 HTML Ruby 语法，去除加粗，确保多平台稳定渲染
        let formattedWord = cleanWord;
        const bracketRegex = /([^\s\[\]\u3040-\u309f]+)\[([^\]]+)\]/g;

        if (bracketRegex.test(cleanWord)) {
            bracketRegex.lastIndex = 0; // 重置正则检索位置
            // 这里导出的文档通常不需要夜间模式类名，所以保持干净
            formattedWord = cleanWord.replace(bracketRegex, '<ruby>$1<rt>$2</rt></ruby>');
        } else if (item.kana && item.kana.trim() !== "") {
            // 若无括号但有独立假名，则将整个词包裹
            let cleanKana = sanitizeMdCell(item.kana).trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
            formattedWord = `<ruby>${cleanWord}<rt>${cleanKana}</rt></ruby>`;
        }

        let wordCol = formattedWord; // 已去除加粗星号 **
        // 全局范围导出时（跨单词本/标签/搜索），标注该词的来源单词本
        if (isGlobalScope) {
            const cleanSource = sanitizeMdCell(item.sourceNotebook || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
            wordCol += `<br><span style="font-size: 0.75em; color: #a8a29e;">〔${cleanSource}〕</span>`;
        }

        let cleanMeaning = sanitizeMdCell(item.meaning).replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        let meaningCol = `${cleanMeaning}`;
        if (item.example) {
            let cleanExample = sanitizeMdCell(item.example).replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            meaningCol += `<br><span style="font-size: 0.85em; color: #78716c;">*例句: ${cleanExample}*</span>`;
        }

        mdContent += `| ${wordCol} | ${meaningCol} |  |\n`;
    });

    try {
        // 新增 '\uFEFF' (UTF-8 BOM) 头，彻底解决 Windows 系统本地打开 MD 文件乱码的问题
        const blob = new Blob(['\uFEFF' + mdContent], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `${safeScopeName}_日语单词练习表.md`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast("🎉 Markdown 练习表导出成功，已开始下载！");
    } catch (err) {
        showToast("导出失败，请检查浏览器隐私及下载设置。");
    }
}

// 18.5 📂 导出练习表下拉菜单控制（合并 PDF / MD 两个入口）
window.toggleExportMenu = function() {
    document.getElementById('export-menu').classList.toggle('hidden');
}

window.chooseExport = function(format) {
    document.getElementById('export-menu').classList.add('hidden');
    if (format === 'pdf') {
        exportToPDF();
    } else if (format === 'json') {
        exportToJSON();
    } else {
        exportToMD();
    }
}

// 18.6 📦 导出 JSON 单词包（所见即所导，与 MD/PDF 共用 getDisplayedCards() 数据源）
// 用途：分享给他人，通过「批量导入 → JSON 导入」离线导入；不含 id / mastered，导入时重新生成
window.exportToJSON = function() {
    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    if (filteredList.length === 0) {
        showToast("当前界面没有可以导出的单词！");
        return;
    }

    // 组装导出范围名称（与 MD 导出同规则）
    let scopeName = activeNotebook;
    if (isGlobalScope) {
        const parts = [];
        if (activeTagFilters.length > 0) parts.push(`标签·${activeTagFilters.join("·")}`);
        if (isGlobalSearch) parts.push("搜索结果");
        scopeName = parts.join("·");
    }
    const safeScopeName = scopeName.replace(/[\\\/:*?"<>|]/g, '_'); // 清洗文件名非法字符

    const pack = {
        format: "vocab-pack",
        version: 1,
        scope: scopeName,
        exportedAt: new Date().toISOString().slice(0, 10),
        cards: filteredList.map(item => ({
            word: item.word,
            kana: item.kana || "",
            meaning: item.meaning || "",
            example: item.example || "",
            tags: Array.isArray(item.tags) ? item.tags : []
        }))
    };

    try {
        const blob = new Blob(['\uFEFF' + JSON.stringify(pack, null, 2)], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `${safeScopeName}_单词包.json`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast(`📦 JSON 单词包导出成功（${pack.cards.length} 个单词），可分享给他人导入！`);
    } catch (err) {
        showToast("导出失败，请检查浏览器隐私及下载设置。");
    }
}

// 点击菜单外部时自动收起下拉
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('export-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        document.getElementById('export-menu').classList.add('hidden');
    }
});

// 19. 🖨️ 一键导出 PDF 练习表（生成打印版页面并调起浏览器打印，选择"另存为PDF"即可）
// 🌟 同样遵循“所见即所导”：与 exportToMD 共用 getDisplayedCards() 数据源
window.exportToPDF = function() {
    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    if (filteredList.length === 0) {
        showToast("当前界面没有可以导出的单词！");
        return;
    }

    // 组装导出范围名称（与 MD 导出保持一致）
    let scopeName = activeNotebook;
    if (isGlobalScope) {
        const parts = [];
        if (activeTagFilters.length > 0) parts.push(`标签·${activeTagFilters.join("·")}`);
        if (isGlobalSearch) parts.push("搜索结果");
        scopeName = parts.join("·");
    }
    const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

    // HTML 转义 + 换行转 <br>（打印页面允许换行），剔除控制字符与损坏的 Unicode
    const escHtml = (text) => String(text || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // bracket 语法转 ruby 注音（与卡片渲染同规则）
    const toRuby = (word, kana) => {
        const safe = escHtml(word);
        const bracketRegex = /([^\s\[\]\u3040-\u309f]+)\[([^\]]+)\]/g;
        if (bracketRegex.test(safe)) {
            bracketRegex.lastIndex = 0;
            return safe.replace(bracketRegex, '<ruby>$1<rt>$2</rt></ruby>');
        }
        if (kana && kana.trim() !== "") {
            return `<ruby>${safe}<rt>${escHtml(kana.trim())}</rt></ruby>`;
        }
        return safe;
    };

    // 组装表格行
    const rowsHtml = filteredList.map(item => {
        let wordCell = toRuby(item.word, item.kana);
        if (isGlobalScope) {
            wordCell += `<br><span class="source-note">〔${escHtml(item.sourceNotebook || '')}〕</span>`;
        }
        let meaningCell = escHtml(item.meaning);
        if (item.example) {
            // 多条例句（以 / 、／ 或换行分隔）在练习表中逐行显示
            const exampleLines = String(item.example).split(/[/／\n]+/).map(s => s.trim()).filter(Boolean);
            exampleLines.forEach((line, idx) => {
                meaningCell += `<br><span class="example-note font-japanese">${exampleLines.length > 1 ? `${toCircledNum(idx + 1)} ` : ''}${escHtml(line)}</span>`;
            });
        }
        return `<tr><td class="word-col font-japanese">${wordCell}</td><td>${meaningCell}</td><td class="write-col"></td></tr>`;
    }).join('\n');

    const printDoc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escHtml(scopeName)}_日语单词练习表</title>
<style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif;
color: #292524; margin: 0; padding: 0;
-webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    /* 日文内容（与网页 .font-japanese 同规则：日文字体优先，回退中文黑体） */
    .font-japanese, rt, .word-col {
font-family: "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    h1 { font-size: 18pt; text-align: center; margin: 0 0 6pt; letter-spacing: 2pt; }
    .meta { text-align: center; font-size: 9pt; color: #78716c; margin-bottom: 14pt; }
    .meta span { margin: 0 8pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td {
border: 1px solid #d6d3d1;
padding: 6pt 8pt;
font-size: 10.5pt;
vertical-align: top;
word-break: break-all;
overflow-wrap: anywhere;
    }
    /* 表头与间隔行底色：打印时强制保留（-webkit-print-color-adjust: exact） */
    th { background: #e7e5e4; font-size: 9.5pt; letter-spacing: 1pt; }
    /* 隔行浅灰底色（偶数行留白），降低串行概率 */
    tbody tr:nth-child(even) { background: #f5f5f4; }
    td.word-col { width: 34%; }
    td.write-col { width: 24%; }
    ruby { ruby-align: center; }
    rt { font-size: 0.55em; color: #8c7e6c; letter-spacing: 0; }
    .source-note { font-size: 7.5pt; color: #a8a29e; }
    .example-note { font-size: 8.5pt; color: #78716c; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    .print-tip { text-align: center; font-size: 9pt; color: #78716c; margin: 12pt 0 0; }
    @media print { .print-tip { display: none; } }
</style>
</head>
<body>
    <h1>📓 日语单词自测练习表</h1>
    <div class="meta">
<span><b>导出范围</b>：${escHtml(scopeName)}${isGlobalScope ? '（跨单词本）' : ''}</span>
<span><b>导出日期</b>：${escHtml(dateStr)}</span>
<span><b>生词总数</b>：${filteredList.length} 词</span>
    </div>
    <table>
<thead>
    <tr><th>单词与假名</th><th>中文释义与例句</th><th>默写/自测备注栏</th></tr>
</thead>
<tbody>
    ${rowsHtml}
</tbody>
    </table>
    <p class="print-tip">🖨️ 在弹出的打印对话框中，将目标打印机选择为「另存为 PDF / Save as PDF」即可导出 PDF 文件。</p>
</body>
</html>`;

    // 打开打印窗口并调起打印（处于用户点击事件内，一般不会被弹窗拦截）
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast("❌ 弹出打印窗口被浏览器拦截，请允许本页面的弹出式窗口后重试。");
        return;
    }
    printWindow.document.open();
    printWindow.document.write(printDoc);
    printWindow.document.close();
    // 等待字体与表格排版稳定后再调起打印
    printWindow.onload = () => {
        setTimeout(() => { printWindow.focus(); printWindow.print(); }, 200);
    };

    showToast("🖨️ 已生成打印版练习表，在打印对话框中选择「另存为 PDF」即可！");
}

window.onload = function() {
    loadData();
}
// Back to top button
const backToTopBtn = document.getElementById('back-to-top-btn');
const updateBackToTopButton = () => {
    backToTopBtn.classList.toggle('is-visible', window.scrollY > 360);
};
window.addEventListener('scroll', updateBackToTopButton, { passive: true });
backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
updateBackToTopButton();
// Add a one-click clear button to every editable text field.
function setupInputClearButtons() {
    const fields = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="range"]):not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]), textarea');

    fields.forEach((field) => {
        if (field.dataset.clearButtonReady === 'true') return;
        field.dataset.clearButtonReady = 'true';

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'input-clear-btn';
        clearButton.setAttribute('aria-label', '清除內容');
        clearButton.title = '清除內容';
        clearButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

        const hasExistingRightAction = field.id === 'input-word' || field.id === 'edit-word';
        let container;
        if (hasExistingRightAction) {
            container = field.parentElement;
            clearButton.classList.add('input-clear-inline');
            field.style.paddingRight = '6.5rem';
            container.appendChild(clearButton);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'input-clear-wrap';
            field.parentNode.insertBefore(wrapper, field);
            wrapper.appendChild(field);
            wrapper.appendChild(clearButton);
            container = wrapper;
        }

        const updateVisibility = () => {
            const hasContent = field.value.length > 0;
            container.classList.toggle('has-content', hasContent);
        };
        field.addEventListener('input', updateVisibility);
        field.addEventListener('change', updateVisibility);
        field.addEventListener('focus', updateVisibility);
        const clearField = () => {
            field.value = '';
            field.focus();
            updateVisibility();

            const notifyFieldChange = () => {
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
            };
            // Clearing a search can rebuild every card. Let the cleared input paint first.
            if (field.id === 'search-input') {
                window.setTimeout(notifyFieldChange, 32);
            } else {
                notifyFieldChange();
            }
        };
        // Clear on press for a responsive mouse/touch interaction, without firing the search render twice.
        let clearedOnPointerDown = false;
        clearButton.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            clearedOnPointerDown = true;
            clearField();
            window.setTimeout(() => { clearedOnPointerDown = false; }, 0);
        });
        clearButton.addEventListener('click', (event) => {
            event.preventDefault();
            if (clearedOnPointerDown) {
                clearedOnPointerDown = false;
                return;
            }
            clearField();
        });
        updateVisibility();
    });
}
setupInputClearButtons();
