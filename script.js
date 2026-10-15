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

// 预装的轻量化内置离线词典数据库
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
let activeTagFilters = []; // 当前选中的全局标签

// ==========================================
// 🏷️ 标签的自定义顺序
// 标签本身没有独立存储（是从各卡 tags 临时聚合的派生数据），所以"自定义顺序"
// 需要额外一份持久化的名单 tagOrder（只存标签名的先后）。
// 它是唯一的排序方式，同时作用于：标签管理面板、顶部标签筛选栏、编辑卡片的历史标签建议条。
// ==========================================
const TAG_ORDER_KEY = 'japanese_vocab_tag_order';
let tagOrder = null;
let layoutMode = "grid"; // "grid" (平铺卡片) 或者是 "list" (迷你列表)
let lastDeletedCard = null;
let lastMasteredCardId = null;
let db = null;
const searchIndexCache = new Map();
let searchDebounceTimer = null;
const cardsPerBatch = 48;
let visibleCardLimit = cardsPerBatch;

// ==========================================
// 🎲 打乱顺序（顺序持久化 + 新卡自动置顶）
// 规则：
//  ① 打乱结果落盘（localStorage），刷新、切单词本、切筛选都沿用同一副顺序，
//     不再"一动就重洗"；只有主动点「打乱顺序」才重新洗牌。
//  ② 新添加的卡不进顺序表，靠"未入序"这一特征被识别为 fresh，
//     渲染时统一排在最前面（连续添加即越新的越靠前），直到下次点「打乱顺序」，
//     重洗时它们才作为普通牌融进牌堆。
//  这样任何新增入口（手动添加 / AI 批量导入 / 云同步拉取）都自动生效，
//  不需要在每个写入点手写一遍"置顶"逻辑。
// ==========================================
const SHUFFLE_ORDER_KEY = 'japanese_vocab_shuffle_order';
let shuffleOrder = null;

// ==========================================
// 🖐️ 卡片拖拽排序（仅在「选中了标签」时启用）
// 设计要点：
//  ① 拖拽门槛：只有 activeTagFilters.length > 0 才算"被筛选"，才给卡片装手柄。
//     搜索、掌握状态筛选都不算——那两种几乎随时处于某种状态，等于一直可拖。
//  ② 落盘策略：只搬动被拖的那一张。把它的 id 从全局 shuffleOrder 里摘出来，
//     插到落点邻居的前/后面，**其余卡片一个都不动**。这样筛选视图里的顺序
//     立刻生效，取消筛选后也依然保留，且不会把"筛选子集"错误地聚成一坨。
//  ③ 不用 HTML5 原生 drag&drop（手机上不可用），用 pointer 事件 + 手柄触发，
//     从而天然避开"点一下就翻面/展开"的冲突——手柄上 stopPropagation 即可。
// ==========================================
const DRAG_FULL_RENDER_LIMIT = 300; // 筛选结果不超过这个数就一次性全部渲染，方便整体拖拽
const DRAG_LONG_PRESS_MS = 300;     // 长按多久算"要拖"（iOS 主屏图标大约也是这个量级）
const DRAG_START_MOVE_PX = 10;      // 鼠标/触控笔：按住后挪这么多也直接起拖（不用等长按）
const DRAG_CANCEL_MOVE_PX = 14;     // 触屏：起拖"之前"挪这么多就放弃，把手势还给页面滚动
const DRAG_EDGE_PX = 72;            // 拖到距视口上下边缘这么近时自动滚动
const DRAG_FLIP_MAX_ITEMS = 120;    // 超过这么多张就不做让位动画（保住拖动流畅度）
let manualCardOrder = false;        // 是否手动拖过（用于「打乱顺序」时给不同的提示）
let dragState = null;
let suppressCardClickUntil = 0;     // 起拖过的那一次抬手会紧跟着一个 click，需要掐掉

// 只有选中标签时才允许拖拽
function isDragSortEnabled() {
    return activeTagFilters.length > 0;
}

function fisherYatesShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// 全库所有卡片 id（跨单词本，一副牌管所有视图）
function getAllCardIds() {
    const ids = [];
    Object.values(notebooks).forEach(cards => (cards || []).forEach(c => ids.push(c.id)));
    return ids;
}

function persistShuffleOrder() {
    try {
        localStorage.setItem(SHUFFLE_ORDER_KEY, JSON.stringify(shuffleOrder || []));
    } catch (e) {
        // 隐私模式等写不进去的场景：降级为"仅本次会话有效"，不影响使用
    }
}

// 读取/初始化顺序表。首次使用（本地没有记录）时生成一副新牌并落盘。
function ensureShuffleOrder() {
    if (shuffleOrder) return shuffleOrder;

    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(SHUFFLE_ORDER_KEY) || 'null');
    } catch (e) {
        saved = null;
    }

    const allIds = getAllCardIds();

    if (Array.isArray(saved) && saved.length > 0) {
        // 剔除已删除的卡留下的无效 id；新卡故意不补进顺序表（补了就不叫置顶了）
        const alive = new Set(allIds);
        shuffleOrder = saved.filter(id => alive.has(id));
        if (shuffleOrder.length === 0) shuffleOrder = fisherYatesShuffle(allIds.slice());
    } else {
        shuffleOrder = fisherYatesShuffle(allIds.slice());
    }

    persistShuffleOrder();
    return shuffleOrder;
}

// 重新洗牌：把当前全部卡片（含之前置顶的新卡）重新打乱并落盘
function reshuffleDisplay() {
    shuffleOrder = fisherYatesShuffle(getAllCardIds());
    persistShuffleOrder();
    manualCardOrder = false; // 重洗即放弃手动排的顺序，两套顺序不打架
    visibleCardLimit = cardsPerBatch;
    renderCards();
}
let lastCardRenderContext = '';

// 2. 从本地存储加载数据
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
        notebooks = JSON.parse(JSON.stringify(defaultNotebooks));
        activeNotebook = "日常";
        saveData();
    }

    if (!notebooks[activeNotebook]) {
        activeNotebook = Object.keys(notebooks)[0] || "日常";
    }

    Object.keys(notebooks).forEach(bookName => {
        notebooks[bookName].forEach((card, idx) => {
            if (card.mastered === undefined) {
                card.mastered = false;
            }
            if (card.tags === undefined) {
                card.tags = [];
            }
            // 兼容旧数据：已掌握的卡补一个掌握时间（用数组下标当基准，
            // 既保留现有相对顺序，又都排在「新标记掌握」的卡片下方）
            if (card.masteredAt === undefined) {
                card.masteredAt = card.mastered ? idx : 0;
            }
        });
    });

    // 清理旧版本遗留的排序档位键（标签排序现在只有"自定义"一种，该键已废弃）
    localStorage.removeItem('japanese_vocab_tag_sort');

    exportSortMode = localStorage.getItem(EXPORT_SORT_KEY) || 'display';
    if (!EXPORT_SORT_LABEL[exportSortMode]) exportSortMode = 'display';
    updateExportSortButtons();
    try {
        const savedOrder = JSON.parse(localStorage.getItem(TAG_ORDER_KEY) || 'null');
        tagOrder = Array.isArray(savedOrder) ? savedOrder : null;
    } catch (e) {
        tagOrder = null;
    }

    const savedToken = localStorage.getItem('gist_token');
    const savedGistId = localStorage.getItem('gist_id');
    if (savedToken) document.getElementById('gist-token').value = savedToken;
    if (savedGistId) document.getElementById('gist-id').value = savedGistId;

    renderNotebookTabs();
    renderCards();
    initIndexedDB();
}

function saveData() {
    localStorage.setItem('japanese_vocab_notebooks', JSON.stringify(notebooks));
    localStorage.setItem('japanese_vocab_active', activeNotebook);
    updateHeaderCount();
}

function rubyBracketRegex() {
    return /([^\s\[\]\u3040-\u309f\u30a0-\u30f4\u30f7-\u30ff]+)\[([^\]]+)\]/g;
}

function parseRubyText(word, fallbackKana) {
    const bracketRegex = rubyBracketRegex();

    if (bracketRegex.test(word)) {
        bracketRegex.lastIndex = 0;
        return word.replace(bracketRegex, '<ruby>$1<rt class="dark:text-night-gold">$2</rt></ruby>');
    }

    if (fallbackKana && fallbackKana.trim() !== "") {
        return `<ruby>${word}<rt class="dark:text-night-gold">${fallbackKana.trim()}</rt></ruby>`;
    }

    return word;
}

function getCleanWordText(word) {
    return String(word || '').replace(rubyBracketRegex(), '$1');
}

function getRubyReading(word) {
    return String(word || '').replace(rubyBracketRegex(), '$2');
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

function toCircledNum(n) {
    return n >= 1 && n <= 10 ? String.fromCodePoint(0x2789 + n) : `${n}.`;
}

function formatExample(exampleText) {
    if (!exampleText) return '';

    const segments = String(exampleText).split(/[/／\n]+/).map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return '';

    const parseSegment = (text) => {
        const match = text.match(/^([\s\S]+?)\s*[(（]([^()（）]+)[)）]\s*$/);
        if (match) {
            return { jp: match[1].trim(), cn: match[2].trim() };
        }
        return { jp: text, cn: '' };
    };

    const jpLineCls = 'font-japanese text-stone-800 dark:text-stone-200 font-medium leading-relaxed transition-colors';
    const jpLineStyle = 'font-size: calc(0.84rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0));';
    const cnLineCls = 'text-stone-500 dark:text-stone-400 leading-normal transition-colors';
    const cnLineStyle = 'font-size: calc(0.75rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0));';

    const renderLine = ({ jp, cn }) => `
        <div class="${jpLineCls}" lang="ja" style="${jpLineStyle}">${jp}</div>
        ${cn ? `<div class="${cnLineCls}" style="${cnLineStyle}">${cn}</div>` : ''}
    `;

    const bodyHtml = segments.length > 1
        ? segments.map((seg, idx) => `
            <div class="flex items-start" style="gap: calc(0.4rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0));${idx > 0 ? ' margin-top: calc(0.5rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0));' : ''}">
                <span class="text-emerald-800/50 dark:text-teal-500/60 shrink-0 transition-colors" style="font-size: calc(0.84rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0)); line-height: 1.625;">${toCircledNum(idx + 1)}</span>
                <div class="min-w-0">${renderLine(parseSegment(seg))}</div>
            </div>
        `).join('')
        : renderLine(parseSegment(segments[0]));

    return `
        <div class="text-left bg-white/70 dark:bg-stone-800/70 rounded-xl border border-stone-200/30 dark:border-stone-700/50 w-full transition-colors" style="padding: calc(0.75rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0));">
            <span class="uppercase font-bold tracking-wider text-emerald-800/50 dark:text-teal-500/60 block transition-colors" style="font-size: var(--fs-tiny, 0.625rem); margin-bottom: calc(0.25rem * var(--font-scale, 1.0) * var(--fit-scale, 1.0));">例句</span>
            ${bodyHtml}
        </div>
    `;
}

function updateHeaderCount() {
    const countEl = document.getElementById('card-count');
    const badgeEl = document.getElementById('active-notebook-badge');

    const list = notebooks[activeNotebook] || [];
    const reviewedList = list.filter(c => !c.mastered);
    const masteredList = list.filter(c => c.mastered);

    countEl.innerHTML = `复习中：<strong class="text-emerald-800 dark:text-teal-500 text-sm font-sans mx-0.5">${reviewedList.length}</strong> · 已掌握：<strong class="text-stone-500 dark:text-stone-400 text-sm font-sans mx-0.5">${masteredList.length}</strong>`;
    badgeEl.innerText = activeNotebook;

    renderGlobalTags();
}

function renderGlobalTags() {
    const container = document.getElementById('global-tags-filter');
    if (!container) return;

    const tagCounts = getTagCounts();
    const allTags = new Set(tagCounts.keys());

    activeTagFilters = activeTagFilters.filter(t => allTags.has(t));

    // 与标签管理面板共用同一套自定义顺序
    const tagsArray = getOrderedTags(tagCounts);
    container.innerHTML = '';
    if (tagsArray.length === 0) {
        updateTagScrollFade();
        return;
    }

    // max-w-[70vw]：防止超长标签在窄屏折行时撑出屏幕（宽屏横滑时也一并受益）
    const activeCls = "px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 bg-emerald-800/[0.12] dark:bg-teal-300/[0.12] text-emerald-800 dark:text-teal-300 shrink-0 whitespace-nowrap max-w-[70vw] truncate";
    const inactiveCls = "px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 bg-transparent text-stone-500 dark:text-stone-400 hover:bg-stone-200/50 dark:hover:bg-stone-700/50 whitespace-nowrap border border-transparent shrink-0 max-w-[70vw] truncate";

    const allBtn = document.createElement('button');
    allBtn.textContent = '全部';
    allBtn.className = activeTagFilters.length === 0 ? activeCls : inactiveCls;
    allBtn.addEventListener('click', () => clearTagFilters());
    container.appendChild(allBtn);

    tagsArray.forEach(tag => {
        const btn = document.createElement('button');
        const isActive = activeTagFilters.includes(tag);
        // 选中时在标签名后显示总词数（全部单词本、不分掌握状态），未选中保持纯净
        btn.innerHTML = isActive
            ? `${tag}<span class="ml-1.5 font-sans text-[10px] opacity-70">${tagCounts.get(tag)}</span>`
            : tag;
        btn.className = isActive ? activeCls : inactiveCls;
        // 无论选中与否都带上完整名称：标签过长会被 truncate 截断，靠 tooltip 补全
        btn.title = isActive
            ? `${tag} · 共 ${tagCounts.get(tag)} 个单词带此标签（全部单词本）`
            : tag;
        btn.addEventListener('click', () => toggleTagFilter(tag));
        container.appendChild(btn);
    });

    if (!container.dataset.scrollBound) {
        container.dataset.scrollBound = '1';
        container.addEventListener('scroll', updateTagScrollFade);
        container.addEventListener('wheel', function(e) {
            if (e.deltaY !== 0 && this.scrollWidth > this.clientWidth) {
                e.preventDefault();
                this.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }
    updateTagScrollFade();
}

// ==========================================
// 🏷️ 标签统计与批量管理（齿轮入口 → 「标签管理」面板）
// 标签是从所有卡片的 tags 聚合而来的派生数据；改名 = 全库替换 + 撞名自动合并
// ==========================================

// 统计每个标签的单词数（全部单词本、不分掌握状态）
function getTagCounts() {
    const counts = new Map();
    Object.keys(notebooks).forEach(bookName => {
        (notebooks[bookName] || []).forEach(card => {
            if (Array.isArray(card.tags)) {
                // 同一张卡上的重复标签只算一次
                new Set(card.tags).forEach(tag => {
                    counts.set(tag, (counts.get(tag) || 0) + 1);
                });
            }
        });
    });
    return counts;
}

function saveTagOrder() {
    localStorage.setItem(TAG_ORDER_KEY, JSON.stringify(tagOrder || []));
}

// 对账：tagOrder 与"当前实际存在的标签"对齐——已消失的剔除，新出现的补到最前面。
// 每次取排序结果前都跑一遍，所以任何入口（加卡打新标签 / 改名 / 删除 / 云同步）都不用各自维护。
function syncTagOrder(allTags) {
    const alive = new Set(allTags);
    let order = (Array.isArray(tagOrder) ? tagOrder : [])
        .filter(t => alive.has(t))
        .filter((t, i, arr) => arr.indexOf(t) === i); // 去重

    const known = new Set(order);
    const fresh = allTags.filter(t => !known.has(t));
    if (fresh.length) order = fresh.concat(order);

    tagOrder = order;
    saveTagOrder();
    return order;
}

// 返回按自定义顺序排好的标签名数组。
// counts 是 getTagCounts() 的结果，其 Map 的插入序恰好等于"标签首次出现的顺序"，
// 所以还没有任何手动排序时，初始顺序就是创建顺序（见 syncTagOrder）。
function getOrderedTags(counts) {
    const allTags = Array.from(counts.keys());
    syncTagOrder(allTags);
    return tagOrder.slice();
}

// 上下箭头：在全局顺序里与相邻项交换
window.moveTag = function(tag, dir) {
    syncTagOrder(Array.from(getTagCounts().keys()));
    const i = tagOrder.indexOf(tag);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= tagOrder.length) return;
    [tagOrder[i], tagOrder[j]] = [tagOrder[j], tagOrder[i]];
    saveTagOrder();
    renderTagManagerList();
    renderGlobalTags();
    renderEditTagSuggestionsIfOpen();
}

window.openTagManager = function() {
    const modal = document.getElementById('tag-manager-modal');
    if (!modal) return;
    // 打开时清空搜索词：否则下次打开会莫名只剩几条，且箭头因过滤被隐藏
    const searchEl = document.getElementById('tag-manager-search');
    if (searchEl) searchEl.value = '';
    renderTagManagerList();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.closeTagManager = function() {
    const modal = document.getElementById('tag-manager-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function renderTagManagerList() {
    const list = document.getElementById('tag-manager-list');
    const emptyEl = document.getElementById('tag-manager-empty');
    if (!list) return;

    const counts = getTagCounts();
    const allTags = getOrderedTags(counts);

    const searchEl = document.getElementById('tag-manager-search');
    const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const tags = query ? allTags.filter(t => t.toLowerCase().includes(query)) : allTags;

    list.innerHTML = '';

    if (tags.length === 0) {
        if (emptyEl) {
            emptyEl.textContent = allTags.length === 0
                ? '还没有任何标签，去编辑单词卡片添加吧。'
                : '没有匹配的标签';
            emptyEl.classList.remove('hidden');
        }
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    // 有搜索词时隐藏箭头：屏幕上看到的是过滤后的行，而"上移"是与全局相邻项交换，
    // 点了之后标签跳到看不见的位置，比干脆不给箭头更糟。
    const showArrows = !query;

    tags.forEach((tag, idx) => {
        const row = document.createElement('div');
        row.className = 'tag-row flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-900/60 border border-stone-200/70 dark:border-stone-700/70';
        row.dataset.tag = tag;

        // 名称列：默认纯文本，点击才就地变输入框。
        // 不再挂铅笔图标：14px 下它的笔画糊成一团，看着像正文里多了一个点。
        // "可点"由三处表达：cursor-text、hover 文字加深（见 style.css）、title 提示。
        const nameCell = document.createElement('div');
        nameCell.className = 'tag-name-cell flex-1 min-w-0 flex items-center';
        const nameText = document.createElement('span');
        nameText.className = 'tag-name-text truncate text-xs font-semibold text-stone-700 dark:text-stone-200 cursor-text';
        nameText.textContent = tag;
        nameText.title = '点击即可修改标签名（作用于全部单词本）';
        nameCell.appendChild(nameText);
        nameCell.addEventListener('click', () => startTagRename(nameCell, tag));
        row.appendChild(nameCell);

        // 词数列：固定宽度 + 右对齐，纵向一眼可比大小
        const countEl = document.createElement('span');
        countEl.className = 'tag-count shrink-0 w-10 text-right text-[11px] text-stone-400 dark:text-stone-500';
        countEl.textContent = counts.get(tag);
        row.appendChild(countEl);

        if (showArrows) {
            row.appendChild(makeTagArrowButton(tag, -1, idx === 0));
            row.appendChild(makeTagArrowButton(tag, 1, idx === tags.length - 1));
        }

        row.appendChild(makeTagDeleteButton(tag, counts.get(tag)));
        list.appendChild(row);
    });
}

// SVG 必须用 createElementNS 创建：createElement('svg') 得到的是 HTMLUnknownElement，
// 浏览器不按图形规则渲染，图标会整个消失。
function makeTagIcon(pathD, cls) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
}

function makeTagArrowButton(tag, dir, disabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shrink-0 p-0.5 rounded text-stone-400 dark:text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors disabled:opacity-25 disabled:cursor-not-allowed';
    btn.title = dir < 0 ? `把「${tag}」上移` : `把「${tag}」下移`;
    btn.disabled = disabled;
    btn.appendChild(makeTagIcon(dir < 0 ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6', 'w-3.5 h-3.5'));
    btn.addEventListener('click', () => moveTag(tag, dir));
    return btn;
}

function makeTagDeleteButton(tag, count) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-del-btn shrink-0 p-1 rounded-md text-stone-400 dark:text-stone-500 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-colors';
    btn.title = `删除标签「${tag}」（影响 ${count} 个单词，8 秒内可撤销）`;
    btn.appendChild(makeTagIcon('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14', 'w-3.5 h-3.5'));
    // 防误触：按下与抬起若位置偏移超过 8px（触屏滑动/鼠标拖拽），视为滑动而非点击
    let downX = 0, downY = 0, downAt = 0;
    btn.addEventListener('pointerdown', (e) => {
        downX = e.clientX; downY = e.clientY; downAt = Date.now();
    });
    btn.addEventListener('click', (e) => {
        const moved = Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8;
        const tooSlow = Date.now() - downAt > 800; // 长按不触发，避免"按着犹豫"的误判
        if (moved || tooSlow) { e.preventDefault(); e.stopPropagation(); return; }
        deleteTagGlobally(tag, count);
    });
    return btn;
}

// 点击标签名 → 就地换成输入框；失焦/回车提交，Esc 取消。
// 输入框用 w-full 而不是按文字宽度实测——后者正是铅笔位置参差的根源。
function startTagRename(cell, oldTag) {
    if (cell.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldTag;
    input.className = 'w-full bg-transparent border-0 p-0 text-xs font-semibold text-stone-700 dark:text-stone-200 focus:outline-none';
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = () => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (next && next !== oldTag) {
            renameTagGlobally(oldTag, next);
        } else {
            renderTagManagerList();
        }
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { done = true; renderTagManagerList(); }
    });
    input.addEventListener('blur', commit);
}

// 全库改名：所有单词本中带 oldTag 的卡片替换为 newTag；newTag 已存在则自动合并
window.renameTagGlobally = function(oldTag, newTag) {
    if (!newTag) { showToast('标签名不能为空'); return; }
    if (newTag === oldTag) { renderTagManagerList(); return; }

    let affected = 0;
    Object.keys(notebooks).forEach(bookName => {
        (notebooks[bookName] || []).forEach(card => {
            if (!Array.isArray(card.tags) || !card.tags.includes(oldTag)) return;
            // 去重：替换后若与已有标签重复，或同一卡上有多个 oldTag，都只保留一个
            const next = [];
            card.tags.forEach(t => {
                const mapped = t === oldTag ? newTag : t;
                if (!next.includes(mapped)) next.push(mapped);
            });
            card.tags = next;
            affected++;
        });
    });

    if (affected === 0) { renderTagManagerList(); return; }

    // 自定义顺序里原地改名，不能让 syncTagOrder 把它当成"新标签"顶到最前面
    if (Array.isArray(tagOrder)) {
        let order = tagOrder.filter(t => t !== newTag); // 撞名合并时先去掉重复项
        const oi = order.indexOf(oldTag);
        if (oi >= 0) order[oi] = newTag; else order.unshift(newTag);
        tagOrder = order;
        saveTagOrder();
    }

    // 选中过滤里若有旧标签名，同步跟上，避免筛选静默失效
    const idx = activeTagFilters.indexOf(oldTag);
    if (idx >= 0) activeTagFilters[idx] = newTag;

    const merged = getTagCounts().has(newTag) && newTag !== oldTag;
    saveData();
    renderGlobalTags();
    renderCards();
    renderTagManagerList();
    renderEditTagSuggestionsIfOpen();
    showToast(merged
        ? `已把「${oldTag}」合并进「${newTag}」，共影响 ${affected} 个单词`
        : `已将标签「${oldTag}」改名为「${newTag}」，共影响 ${affected} 个单词`);
}

// ==========================================
// ⚠️ 通用确认弹窗（替代浏览器原生 confirm，保持 UI 风格统一）
// 用法：openConfirmModal({ title, message, confirmText, cancelText, danger, onConfirm })
// ==========================================
let confirmModalCallback = null;

window.openConfirmModal = function(options) {
    const opts = options || {};
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    if (!modal || !titleEl || !messageEl || !okBtn) return;

    titleEl.textContent = opts.title || '确认操作？';
    // message 支持换行：\n 转成 <br>，同时对内容做转义，避免标签名里的特殊字符破坏结构
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    messageEl.innerHTML = escapeHtml(opts.message || '').replace(/\n/g, '<br>');
    okBtn.textContent = opts.confirmText || '确认';

    const isDanger = opts.danger !== false;
    okBtn.className = isDanger
        ? 'px-5 py-2 bg-danger-600 dark:bg-danger-700 text-white rounded-xl text-xs font-semibold hover:bg-danger-700 dark:hover:bg-danger-600 transition shadow-sm'
        : 'px-5 py-2 bg-emerald-800 dark:bg-teal-700 text-white rounded-xl text-xs font-semibold hover:bg-emerald-900 dark:hover:bg-teal-600 transition shadow-sm';

    confirmModalCallback = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.closeConfirmModal = function() {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    confirmModalCallback = null;
}

window.submitConfirmModal = function() {
    const cb = confirmModalCallback;
    closeConfirmModal();
    if (cb) cb();
}

// 全库删除标签：从所有卡片移除（卡片本身保留）。
// 采用「立即执行 + Toast 撤销」而非叠一层确认弹窗——标签是派生数据，
// 误删的补救成本高，撤销比事后确认更贴合真实使用节奏。
function deleteTagGlobally(tag, count) {
    // 留一份可回滚的快照：每个被改动的卡片记录它原本的 tags
    const snapshot = [];
    Object.keys(notebooks).forEach(bookName => {
        (notebooks[bookName] || []).forEach(card => {
            if (Array.isArray(card.tags) && card.tags.includes(tag)) {
                snapshot.push({ card, tags: card.tags.slice() });
            }
        });
    });

    const filterSnapshot = activeTagFilters.slice();

    // 执行删除
    snapshot.forEach(({ card }) => {
        card.tags = card.tags.filter(t => t !== tag);
    });
    activeTagFilters = activeTagFilters.filter(t => t !== tag);

    saveData();
    renderGlobalTags();
    renderCards();
    renderTagManagerList();
    renderEditTagSuggestionsIfOpen();

    showToast(`已从 ${snapshot.length} 个单词上移除标签「${tag}」`, () => {
        // 撤销：把每个卡片原本的 tags 覆盖回去（不区分是否被后续操作改过）
        snapshot.forEach(({ card, tags }) => { card.tags = tags.slice(); });
        activeTagFilters = filterSnapshot;

        saveData();
        renderGlobalTags();
        renderCards();
        renderTagManagerList();
        renderEditTagSuggestionsIfOpen();

        showToast('撤销成功，标签已恢复');
    }, 8000);
}

// 若编辑卡片弹窗正开着，同步刷新其标签建议列表，避免显示已被删除的标签
function renderEditTagSuggestionsIfOpen() {
    const modal = document.getElementById('edit-card-modal');
    if (modal && !modal.classList.contains('hidden')) {
        if (typeof renderEditTags === 'function') renderEditTags();
    }
}

function updateTagScrollFade() {
    const el = document.getElementById('global-tags-filter');
    if (!el) return;
    el.classList.remove('tag-fade-left', 'tag-fade-right', 'tag-fade-both');
    // 渐隐提示改用外层绝对定位的渐变覆盖层（见 style.css .tag-fade-overlay）：
    // mask-image 会把标签文字强制降级为灰度抗锯齿，12px 粗体中文看起来发虚。
    const showLeft = (on) => document.getElementById('tag-fade-overlay-left')?.classList.toggle('is-visible', on);
    const showRight = (on) => document.getElementById('tag-fade-overlay-right')?.classList.toggle('is-visible', on);
    if (el.scrollWidth <= el.clientWidth + 1) {
        showLeft(false); showRight(false);
        return;
    }
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    if (!atStart && !atEnd) el.classList.add('tag-fade-both');
    else if (!atEnd) el.classList.add('tag-fade-right');
    else if (!atStart) el.classList.add('tag-fade-left');
    showLeft(!atStart);
    showRight(!atEnd);
}

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

window.clearTagFilters = function() {
    if (activeTagFilters.length === 0) return;
    activeTagFilters = [];
    renderGlobalTags();
    renderCards();
}

function showToast(msg, onUndo = null, duration = 4000) {
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
    }, duration);
}

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

window.setViewMode = function(mode) {
    layoutMode = mode;
    const gridBtn = document.getElementById('view-grid-btn');
    const listBtn = document.getElementById('view-list-btn');
    const gridContainer = document.getElementById('cards-grid');

    if (mode === "grid") {
        gridBtn.className = "px-3.5 py-1.5 whitespace-nowrap w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 bg-white dark:bg-stone-700 text-emerald-800 dark:text-teal-400 shadow-sm flex items-center justify-center space-x-1.5";
        listBtn.className = "px-3.5 py-1.5 whitespace-nowrap w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 flex items-center justify-center space-x-1.5";
        gridContainer.className = "adaptive-grid";
    } else {
        gridBtn.className = "px-3.5 py-1.5 whitespace-nowrap w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 flex items-center justify-center space-x-1.5";
        listBtn.className = "px-3.5 py-1.5 whitespace-nowrap w-1/2 sm:w-auto rounded-lg text-xs font-bold transition duration-200 bg-white dark:bg-stone-700 text-emerald-800 dark:text-teal-400 shadow-sm flex items-center justify-center space-x-1.5";
        // 列表模式也吃 --card-scale：宽度由「卡片大小」滑块控制（见 style.css 的 .list-grid）
        gridContainer.className = "list-grid";
    }
    renderCards();
}

window.changeCardScale = function(val) {
    const scale = parseFloat(val);
    const grid = document.getElementById('cards-grid');
    grid.style.setProperty('--card-scale', scale);
    // 密度模式：卡片缩小时字号按 0.6 次幂缩得比卡片慢（小卡更易读、密度更高），
    // 放大时字号与卡片完全等比（拉大细看单词）
    grid.style.setProperty('--font-scale', scale >= 1 ? scale : Math.pow(scale, 0.6));
    grid.style.setProperty('--card-width', (300 * scale) + 'px');
    grid.style.setProperty('--card-height', (380 * scale) + 'px');
    grid.dataset.compact = scale < 0.9 ? 'true' : 'false';
    document.getElementById('scale-value').innerText = Math.round(scale * 100) + '%';
    // 卡片尺寸变了，可见区域内的卡片需要重新做 fit-to-card 适配（防抖批处理）
    scheduleRefit();
}

function renderNotebookTabs() {
    const container = document.getElementById('notebook-tabs');
    const names = Object.keys(notebooks);

    // 智能显隐：只有 1 本单词本时隐藏内容区 tabs 行（切换收进顶栏徽章下拉），≥2 本自动出现
    const tabsRow = document.getElementById('notebook-tabs-row');
    if (tabsRow) tabsRow.classList.toggle('hidden', names.length <= 1);

    container.innerHTML = names.map(name => {
        const isActive = name === activeNotebook;
        const activeStyle = "bg-emerald-800 dark:bg-teal-700 text-white shadow-sm font-semibold";
        const inactiveStyle = "bg-white dark:bg-stone-800 hover:bg-stone-100/80 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600";

        const reviewCount = notebooks[name].filter(c => !c.mastered).length;

        return `
            <button onclick="switchNotebook('${name}')" class="px-4 py-1.5 rounded-full text-xs transition-colors duration-200 whitespace-nowrap ${isActive ? activeStyle : inactiveStyle}">
                ${name}
                <span class="ml-1 text-[10px] opacity-60">(${reviewCount})</span>
            </button>
        `;
    }).join('');

    renderNotebookMenu();
}

// 顶栏徽章下拉菜单：单词本列表（含复习中词数）+ 切换
function renderNotebookMenu() {
    const listEl = document.getElementById('notebook-menu-list');
    if (!listEl) return;
    const names = Object.keys(notebooks);
    listEl.innerHTML = names.map(name => {
        const isActive = name === activeNotebook;
        const reviewCount = notebooks[name].filter(c => !c.mastered).length;
        return `
            <button onclick="switchNotebookFromMenu('${name}')" class="w-full px-3 py-2 rounded-lg text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors ${isActive ? 'bg-emerald-800/[0.12] dark:bg-teal-300/[0.12] text-emerald-800 dark:text-teal-300' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'}">
                <span class="truncate">${name}</span>
                <span class="text-[10px] opacity-60 shrink-0">${reviewCount}</span>
            </button>
        `;
    }).join('');
}

window.toggleNotebookMenu = function(event) {
    if (event) event.stopPropagation();
    document.getElementById('notebook-menu').classList.toggle('hidden');
}

window.switchNotebookFromMenu = function(name) {
    switchNotebook(name);
    document.getElementById('notebook-menu').classList.add('hidden');
}

// 点击菜单外部任意处关闭
document.addEventListener('click', function(e) {
    const menu = document.getElementById('notebook-menu');
    if (menu && !menu.classList.contains('hidden')
        && !e.target.closest('#notebook-menu')
        && !e.target.closest('#notebook-badge-btn')) {
        menu.classList.add('hidden');
    }
});

window.switchNotebook = function(name) {
    activeNotebook = name;
    activeTagFilters = [];
    saveData();
    renderNotebookTabs();
    renderCards();
}

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

window.openRenameNotebookModal = function() {
    const modal = document.getElementById('rename-notebook-modal');
    const input = document.getElementById('rename-notebook-input');
    const oldNameSpan = document.getElementById('rename-notebook-oldname');

    oldNameSpan.innerText = activeNotebook;
    input.value = activeNotebook;

    modal.classList.remove('hidden');
    setTimeout(() => {
        input.focus();
        input.select();
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
        return;
    }
    if (notebooks[newName]) {
        showToast("该单词本名称已存在，请换一个名字！");
        return;
    }

    notebooks[newName] = notebooks[oldName];
    delete notebooks[oldName];

    activeNotebook = newName;

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

// ==========================================
// 📤 导出顺序
// 界面顺序 = getDisplayedCards() 的原序（打乱顺序 ∩ 当前筛选），是默认档。
// 其余三档只在导出时重排，**不改变屏幕上的顺序，也不写回 shuffleOrder**。
// ==========================================
const EXPORT_SORT_KEY = 'japanese_vocab_export_sort';
const EXPORT_SORT_LABEL = {
    display: '界面顺序',
    gojuon: '五十音',
    added: '添加顺序',
    tag: '按标签分组'
};
let exportSortMode = 'display';

function updateExportSortButtons() {
    const activeCls = "export-sort-btn px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors bg-emerald-800/[0.12] dark:bg-teal-300/[0.12] text-emerald-800 dark:text-teal-300 shadow-sm";
    const inactiveCls = "export-sort-btn px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-700 hover:text-stone-800 dark:hover:text-stone-200";
    Object.keys(EXPORT_SORT_LABEL).forEach(m => {
        const el = document.getElementById('export-sort-' + m);
        if (el) el.className = (exportSortMode === m) ? activeCls : inactiveCls;
    });
    // 主按钮的 tooltip 带上当前档位，不用打开菜单也知道会按什么顺序导出
    const mainBtn = document.querySelector('#export-dropdown > button');
    if (mainBtn) mainBtn.title = `导出当前界面显示的单词为练习表（当前顺序：${EXPORT_SORT_LABEL[exportSortMode]}）`;
}

window.setExportSortMode = function(mode) {
    if (!EXPORT_SORT_LABEL[mode]) return;
    exportSortMode = mode;
    localStorage.setItem(EXPORT_SORT_KEY, mode);
    updateExportSortButtons();
}

// 五十音档的排序键：单词里的方括号注音 → kana 字段 → 单词本身，逐级降级。
// 片假名统一折算成平假名，否则「カ」和「か」会被排到两个完全不同的位置。
function gojuonKey(item) {
    const bracket = String(item.word || '').match(/\[([^\]]+)\]/);
    const raw = bracket ? bracket[1]
        : (item.kana && item.kana.trim() ? item.kana.trim() : String(item.word || ''));
    return raw.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 卡片 id 是 Date.now()（纯 13 位）或 Date.now()+随机后缀，取前 13 位即添加时间。
// 早期手写 id（如 "m1"）解析不出 → 返回 null，排序时统一沉到最后并保持界面顺序。
function addedTimeKey(item) {
    const m = String(item.id || '').match(/^\d{13}/);
    // 注意取 m[0]：上面这条正则没有捕获组，m[1] 是 undefined，Number(undefined) 会静默变成 NaN，
    // 于是所有卡的时间戳都失效、排序静默退化成原序（踩过一次）。
    return m ? Number(m[0]) : null;
}

// 返回 { flat, groups }：groups 只在「按标签分组」档有值（[{label, items}]），其余档为 null。
function applyExportSort(list) {
    if (exportSortMode === 'display') return { flat: list, groups: null };

    if (exportSortMode === 'gojuon') {
        // 直接比码点：平假名块 U+3041~U+309F 本身就是あいうえお序，
        // 濁音（が ぎ ぐ）紧跟在同行的清音（か き く）之后，符合纸质五十音表的习惯。
        return {
            flat: list.slice().sort((a, b) => {
                const ka = gojuonKey(a), kb = gojuonKey(b);
                return ka < kb ? -1 : ka > kb ? 1 : 0;
            }),
            groups: null
        };
    }

    if (exportSortMode === 'added') {
        // 最新添加的排最前面（时间倒序）。解析不出时间的旧卡仍然沉到最后。
        const idx = new Map(list.map((it, i) => [it, i]));
        return {
            flat: list.slice().sort((a, b) => {
                const ta = addedTimeKey(a), tb = addedTimeKey(b);
                if (ta === null && tb === null) return idx.get(a) - idx.get(b);
                if (ta === null) return 1;
                if (tb === null) return -1;
                return (tb - ta) || (idx.get(a) - idx.get(b));
            }),
            groups: null
        };
    }

    // 按标签：分组先后沿用标签的自定义顺序（与管理面板同一套），无标签的归「未分类」沉底
    const rank = new Map(getOrderedTags(getTagCounts()).map((t, i) => [t, i]));
    const buckets = new Map();
    list.forEach(item => {
        const key = (Array.isArray(item.tags) && item.tags.length) ? item.tags[0] : '未分类';
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
    });
    const keys = Array.from(buckets.keys()).sort((a, b) => {
        const ra = rank.has(a) ? rank.get(a) : Infinity; // 未分类 → Infinity，自然沉底
        const rb = rank.has(b) ? rank.get(b) : Infinity;
        return ra - rb || a.localeCompare(b, 'zh-Hans-CN');
    });
    const groups = keys.map(k => ({ label: k, items: buckets.get(k) }));
    return { flat: groups.flatMap(g => g.items), groups };
}

function getDisplayedCards() {
    const searchVal = document.getElementById('search-input').value;
    const searchTerms = getSearchTerms(searchVal);
    const isGlobalSearch = searchTerms.length > 0;
    const isGlobalScope = isGlobalSearch || activeTagFilters.length > 0;
    const currentList = isGlobalScope
        ? Object.entries(notebooks).flatMap(([notebookName, cards]) => cards.map(card => ({ ...card, sourceNotebook: notebookName })))
        : (notebooks[activeNotebook] || []).map(card => ({ ...card, sourceNotebook: activeNotebook }));

    let filteredList = currentList.filter(item => {
        if (cardFilter === "all") return true;
        if (cardFilter === "review") {
            return !item.mastered;
        } else {
            return item.mastered;
        }
    });

    if (activeTagFilters.length > 0) {
        filteredList = filteredList.filter(item =>
            item.tags && activeTagFilters.every(t => item.tags.includes(t))
        );
    }

    filteredList = filteredList.filter(item => matchesSearchTerms(item, searchTerms));

    if (cardFilter === "mastered") {
        // 已掌握视图：最新标记的排在最上面（按掌握时间倒序）
        filteredList.sort((a, b) => (b.masteredAt || 0) - (a.masteredAt || 0));
    } else {
        // 顺序编排：已入序的卡按打乱顺序排；未入序的（刚添加的新卡）原样浮到最前，
        // 且不打断其余卡片的相对顺序（不再"一加新卡就整副重洗"）
        ensureShuffleOrder();
        const rank = new Map(shuffleOrder.map((id, idx) => [id, idx]));
        const freshCards = [];
        const settledCards = [];
        filteredList.forEach(item => (rank.has(item.id) ? settledCards : freshCards).push(item));
        settledCards.sort((a, b) => rank.get(a.id) - rank.get(b.id));
        filteredList = freshCards.concat(settledCards);
    }

    return { filteredList, isGlobalSearch, isGlobalScope };
}

// 卡内的按钮/输入框不参与长按拖拽，否则会挡住它们自己的点击
function isDragExcludedTarget(target) {
    return !!(target && target.closest &&
        target.closest('button, a, input, textarea, select, label, [data-no-drag]'));
}

function onCardDragPointerDown(e) {
    if (!isDragSortEnabled() || dragState) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    const cardEl = e.target && e.target.closest ? e.target.closest('[data-card-id]') : null;
    if (!cardEl || !cardEl.parentElement || cardEl.parentElement.id !== 'cards-grid') return;
    if (isDragExcludedTarget(e.target)) return;

    dragState = {
        el: cardEl,
        id: cardEl.dataset.cardId,
        grid: cardEl.parentElement,
        startX: e.clientX,
        startY: e.clientY,
        startIndex: -1,
        started: false,
        isTouch: e.pointerType === 'touch',
        timer: null,
        ghost: null,
        rect: null,
        overEl: null,
        overAfter: null
    };

    // 这里不能 preventDefault（会连带把 mousedown 掐掉，click 就没了），
    // 所以"拖过之后的那次 click"改由 onCardDragClickGuard 统一掐。
    dragState.timer = setTimeout(beginCardDrag, DRAG_LONG_PRESS_MS);

    window.addEventListener('pointermove', onCardDragPointerMove);
    window.addEventListener('pointerup', onCardDragPointerUp);
    window.addEventListener('pointercancel', onCardDragPointerCancel);
}

// 卡片"浮起来"：本体留在原位做半透明占位，跟着指针走的是一份 fixed 克隆
function beginCardDrag() {
    const s = dragState;
    if (!s || s.started) return;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    s.started = true;
    s.startIndex = Array.prototype.indexOf.call(s.grid.children, s.el);

    const rect = s.el.getBoundingClientRect();
    s.rect = rect;

    const ghost = s.el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('onclick');
    ghost.style.position = 'fixed';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.margin = '0';

    // 克隆被移到 body 下，就脱离了 #cards-grid 的继承链，而卡片尺寸/字号全部建立在
    // 那几个变量上（.perspective 还有 height: var(--card-height) !important）。
    // 不把这些变量搬过来的话，克隆会当场塌成一条 2px 的线——踩过。
    const gridVars = getComputedStyle(s.grid);
    ['--card-scale', '--font-scale', '--card-width', '--card-height'].forEach(name => {
        const v = gridVars.getPropertyValue(name);
        if (v) ghost.style.setProperty(name, v.trim());
    });
    // 内联 !important：样式表里的 !important 只有内联 !important 压得住
    ghost.style.setProperty('width', rect.width + 'px', 'important');
    ghost.style.setProperty('height', rect.height + 'px', 'important');

    document.body.appendChild(ghost);
    s.ghost = ghost;

    s.el.classList.add('drag-placeholder');
    document.body.classList.add('card-dragging');
    // 触屏上给一下轻震动，告诉用户"已经拿起来了"（桌面端 navigator.vibrate 不存在，静默跳过）
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* 忽略 */ }
}

function onCardDragPointerMove(e) {
    const s = dragState;
    if (!s) return;

    if (!s.started) {
        const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (!s.isTouch && dist >= DRAG_START_MOVE_PX) {
            beginCardDrag();
        } else if (dist >= DRAG_CANCEL_MOVE_PX) {
            // 触屏上这个动作多半是想滚页面，别抢
            cancelCardDrag();
            return;
        } else {
            return;
        }
        if (!s.started) return;
    }

    // 克隆跟着指针走（fixed + transform，不碰布局，不引起重排）
    s.ghost.style.transform =
        'translate3d(' + (e.clientX - s.startX) + 'px,' + (e.clientY - s.startY) + 'px,0) scale(1.04)';

    // 拖到视口上下边缘时自动滚动，否则长列表没法把卡拖到远处
    if (e.clientY < DRAG_EDGE_PX) {
        window.scrollBy(0, -Math.ceil((DRAG_EDGE_PX - e.clientY) / 6));
    } else if (e.clientY > window.innerHeight - DRAG_EDGE_PX) {
        window.scrollBy(0, Math.ceil((e.clientY - (window.innerHeight - DRAG_EDGE_PX)) / 6));
    }

    // 克隆是 pointer-events:none，所以这里命中的一定是别的元素
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under || !under.closest) return;
    const over = under.closest('[data-card-id]');
    if (!over || over === s.el || over.parentElement !== s.grid) return;

    const r = over.getBoundingClientRect();
    // 平铺按横向中线判断插到目标前/后；列表按纵向中线
    const after = (layoutMode === 'list')
        ? (e.clientY > r.top + r.height / 2)
        : (e.clientX > r.left + r.width / 2);

    // 落点没变就别动 DOM：重复 insertBefore 会让让位动画反复重启
    if (s.overEl === over && s.overAfter === after) return;
    s.overEl = over;
    s.overAfter = after;

    flipInsertBefore(s.grid, s.el, after ? over.nextSibling : over);
}

// FLIP：先量旧位置 → 移动节点 → 用 transform 把每张卡"拉回"旧位置 → 下一帧归零，
// 于是让位过程就是一段平滑动画。卡片太多时直接跳过动画（拖动流畅度优先）。
function flipInsertBefore(grid, el, refNode) {
    const items = Array.prototype.slice.call(grid.children);
    const animate = items.length <= DRAG_FLIP_MAX_ITEMS;
    let before = null;

    if (animate) {
        // 先复位：上一次动画可能还没跑完，残留的 transform 会让"起始位置"量错
        items.forEach(c => { c.style.transition = 'none'; c.style.transform = ''; });
        before = items.map(c => c.getBoundingClientRect());
    }

    grid.insertBefore(el, refNode);
    if (!animate) return;

    items.forEach((c, i) => {
        const b = before[i], a = c.getBoundingClientRect();
        const dx = b.left - a.left, dy = b.top - a.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        c.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
        requestAnimationFrame(() => {
            c.style.transition = 'transform .18s ease';
            c.style.transform = '';
            // 动画收尾后清掉内联样式，否则会盖住卡片自带的 hover/展开过渡
            setTimeout(() => {
                if (c.style.transform === '') c.style.transition = '';
            }, 200);
        });
    });
}

function detachCardDragListeners() {
    window.removeEventListener('pointermove', onCardDragPointerMove);
    window.removeEventListener('pointerup', onCardDragPointerUp);
    window.removeEventListener('pointercancel', onCardDragPointerCancel);
}

// 还没起拖就放弃（触屏多半是去滚页面了）：不留任何痕迹，click 照常派发
function cancelCardDrag() {
    const s = dragState;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    detachCardDragListeners();
    dragState = null;
}

function onCardDragPointerUp() {
    const s = dragState;
    if (!s) return;
    detachCardDragListeners();
    dragState = null;
    if (!s.started) return; // 没起拖 = 就是一次普通点击，交还给卡片自己处理
    finishCardDrag(s);
}

function onCardDragPointerCancel() {
    const s = dragState;
    if (!s) return;
    detachCardDragListeners();
    dragState = null;
    if (!s.started) return; // 长按计时被系统打断，什么都没发生
    finishCardDrag(s);      // 已经拖起来了，就按当前落点收尾
}

function finishCardDrag(s) {
    // 掐掉紧随其后的那一次 click，否则松手顺手就把卡片翻面/展开了
    suppressCardClickUntil = Date.now() + 400;

    if (s.ghost) {
        // 克隆先滑回占位处再消失，落点一目了然，不会"啪"地瞬移
        const dest = s.el.getBoundingClientRect();
        s.ghost.classList.add('drag-ghost-landing');
        s.ghost.style.transition = 'transform .16s cubic-bezier(.2,.8,.3,1), box-shadow .16s ease';
        s.ghost.style.transform =
            'translate3d(' + (dest.left - s.rect.left) + 'px,' + (dest.top - s.rect.top) + 'px,0) scale(1)';
        const ghost = s.ghost;
        setTimeout(() => ghost.remove(), 180);
    }
    s.el.classList.remove('drag-placeholder');
    document.body.classList.remove('card-dragging');

    const endIndex = Array.prototype.indexOf.call(s.grid.children, s.el);
    if (endIndex === s.startIndex) return; // 原地放下：不写盘，也不打上"手动排过序"的标记

    // 落点邻居：优先看"后面那张"，没有就看"前面那张"
    const nextEl = s.el.nextElementSibling;
    const prevEl = s.el.previousElementSibling;
    const nextId = (nextEl && nextEl.dataset) ? nextEl.dataset.cardId : null;
    const prevId = (prevEl && prevEl.dataset) ? prevEl.dataset.cardId : null;
    if (!nextId && !prevId) return; // 只有一张卡，无从排序

    commitCardDragOrder(s.id, nextId, prevId);
}

// capture 阶段掐 click：这样它到不了卡片上的 onclick="flipCard/toggleListExpand"
function onCardDragClickGuard(e) {
    if (Date.now() >= suppressCardClickUntil) return;
    suppressCardClickUntil = 0;
    e.stopPropagation();
    e.preventDefault();
}

// 把拖动结果写回全局那副牌（shuffleOrder），只搬动被拖动的那一张
function commitCardDragOrder(draggedId, nextId, prevId) {
    ensureShuffleOrder();

    // 兜底：若被显示的卡里有"未入序的新卡"（它们原本靠 fresh 规则浮在最前），
    // 先把它们按当前显示顺序钉到顺序表最前面——显示结果不变，但此后都能参与排序。
    const grid = document.getElementById('cards-grid');
    const shownIds = grid ? Array.from(grid.querySelectorAll('[data-card-id]')).map(el => el.dataset.cardId) : [];
    const inOrder = new Set(shuffleOrder);
    const freshIds = shownIds.filter(id => !inOrder.has(id));
    if (freshIds.length > 0) shuffleOrder = freshIds.concat(shuffleOrder);

    const from = shuffleOrder.indexOf(draggedId);
    if (from < 0) { persistShuffleOrder(); return; }

    shuffleOrder.splice(from, 1);
    let to;
    if (nextId) {
        to = shuffleOrder.indexOf(nextId);
    } else {
        to = shuffleOrder.indexOf(prevId) + 1;
    }
    if (to < 0) to = shuffleOrder.length; // 邻居找不到了（极端情况）就沉到最后
    shuffleOrder.splice(to, 0, draggedId);

    persistShuffleOrder();
    manualCardOrder = true;
    // 不弹 Toast：卡片落到哪一眼就看见了，右下角再蹦一个提示纯属打扰
}

function initCardDragSort() {
    document.addEventListener('pointerdown', onCardDragPointerDown, true);
    document.addEventListener('click', onCardDragClickGuard, true);
    // 起拖之后才拦 touchmove（未起拖时拦了就没法滚页面了），滚动交给边缘自动滚
    window.addEventListener('touchmove', (e) => {
        if (dragState && dragState.started) e.preventDefault();
    }, { passive: false });
}

// 兜底清理：重渲染会把卡片 DOM 整个换掉，若此时正好有拖拽在跑（例如拖动途中
// 改了窗口尺寸触发重渲染），那枚跟着指针的克隆和 body 上的光标状态都会变成孤儿。
function purgeDragArtifacts() {
    if (dragState) {
        detachCardDragListeners();
        if (dragState.timer) clearTimeout(dragState.timer);
        dragState = null;
    }
    document.querySelectorAll('.drag-ghost').forEach(el => el.remove());
    document.querySelectorAll('.drag-placeholder').forEach(el => el.classList.remove('drag-placeholder'));
    document.body.classList.remove('card-dragging');
}

function renderCards() {
    purgeDragArtifacts();
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

    // 标签筛选且结果不多时一次性全部渲染，方便整体拖拽排序；
    // 超过上限仍按批加载（这时拖拽只在已加载的卡片之间进行）。
    const dragOn = isDragSortEnabled();
    if (dragOn && totalCardCount <= DRAG_FULL_RENDER_LIMIT) {
        visibleCardLimit = totalCardCount;
    }
    const visibleCards = filteredList.slice(0, visibleCardLimit);

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

    if (layoutMode === "grid") {
        grid.className = "adaptive-grid" + (dragOn ? " drag-enabled" : "");
    } else {
        grid.className = "list-grid" + (dragOn ? " drag-enabled" : "");
    }

    // 提示条只在"真的能拖"时出现（选中标签且不止一张卡）
    const hint = document.getElementById('drag-sort-hint');
    if (hint) {
        if (dragOn && totalCardCount > 1) {
            hint.classList.remove('hidden');
            hint.classList.add('flex');
        } else {
            hint.classList.add('hidden');
            hint.classList.remove('flex');
        }
    }

    grid.innerHTML = visibleCards.map(item => buildCardHtml(item, isGlobalScope)).join('');
    observeCardsForFit();

    updateLoadMoreControl(totalCardCount);
    updateHeaderCount();
}

function buildCardHtml(item, isGlobalScope) {
        const rubyBack = parseRubyText(item.word, item.kana);
        const cleanWordFront = item.word.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');
        const sourceNotebook = item.sourceNotebook || activeNotebook;
        const dragOn = isDragSortEnabled();
        const notebookBadgeHtml = isGlobalScope
            ? `<span class="px-1.5 py-0.5 rounded-md bg-stone-100 dark:bg-stone-700/60 text-stone-500 dark:text-stone-300 font-medium" style="font-size: var(--fs-tiny);">${sourceNotebook} · ${item.mastered ? '已掌握' : '复习中'}</span>`
            : '';

        const masterButtonHtml = `
            <button onclick="toggleCardMastered(event, '${item.id}', '${sourceNotebook}')" class="${item.mastered ? 'text-emerald-600 dark:text-teal-400 hover:text-emerald-700 dark:hover:text-teal-300 bg-emerald-50 dark:bg-teal-900/30' : 'text-stone-300 dark:text-stone-600 hover:text-emerald-600 dark:hover:text-teal-400 hover:bg-emerald-50 dark:hover:bg-stone-700/50'} rounded-lg transition duration-150 shrink-0 flex items-center justify-center" style="padding: calc(0.375rem * var(--card-scale, 1.0));" title="${item.mastered ? '移回复习中' : '标记为已掌握'}">
                <svg class="w-4 h-4" style="width: calc(1rem * var(--card-scale, 1.0)); height: calc(1rem * var(--card-scale, 1.0));" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="${item.mastered ? '2.2' : '2.5'}" d="${item.mastered ? 'M10 19l-7-7m0 0l7-7m-7 7h18' : 'M5 13l4 4L19 7'}"></path>
                </svg>
            </button>
        `;

        const editButtonHtml = `
            <button onclick="openEditCardModal(event, '${item.id}', '${sourceNotebook}')" class="text-stone-300 dark:text-stone-600 hover:text-emerald-600 dark:hover:text-teal-400 hover:bg-emerald-50 dark:hover:bg-stone-700/50 rounded-lg transition duration-150 shrink-0 flex items-center justify-center" style="padding: calc(0.375rem * var(--card-scale, 1.0));" title="修改卡片内容">
                <svg class="w-4 h-4" style="width: calc(1rem * var(--card-scale, 1.0)); height: calc(1rem * var(--card-scale, 1.0));" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            </button>
        `;

        if (layoutMode === "grid") {
            let tagsHtml = '';
            if (item.tags && item.tags.length > 0) {
                tagsHtml = item.tags.map(tag => `<span class="px-1.5 py-0.5 bg-emerald-800/[0.12] dark:bg-teal-300/[0.12] text-emerald-800 dark:text-teal-300 rounded text-[10px] mr-1 font-medium shrink-0">${tag}</span>`).join('');
            }

            return `
                <div class="perspective group cursor-pointer card-scale-box" data-card-id="${item.id}" data-has-example="${item.example ? 'true' : 'false'}" onclick="flipCard(this)">
                    <div class="card-inner relative w-full h-full rounded-2xl shadow-sm border border-stone-200/80 dark:border-stone-700/80 bg-white dark:bg-stone-800${flippedCardIds.has(item.id) ? ' is-flipped' : ''}">

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

                            <div class="flex-grow w-full overflow-hidden relative">
                                <div class="card-content-scroll w-full h-full flex flex-col justify-start">
                                    <div class="w-full my-auto flex flex-col" style="gap: calc(var(--spacing-gap) * var(--fit-scale, 1.0));">
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
                        </div>
                    </div>
                </div>
            `;
        } else {
            let tagsHtmlList = '';
            if (item.tags && item.tags.length > 0) {
                tagsHtmlList = item.tags.map(tag => `<span class="px-1.5 py-0.5 bg-emerald-800/[0.12] dark:bg-teal-300/[0.12] text-emerald-800 dark:text-teal-300 rounded text-[10px] font-medium">${tag}</span>`).join('');
            }

            return `
                <div data-card-id="${item.id}" class="bg-white dark:bg-stone-800 border border-stone-200/80 dark:border-stone-700/80 rounded-xl shadow-sm hover:border-emerald-600/20 dark:hover:border-teal-600/30 transition-all duration-200 overflow-hidden cursor-pointer" onclick="toggleListExpand(this)">
                    <div class="list-row-main px-4 flex justify-between items-center gap-3 bg-white dark:bg-stone-800 hover:bg-stone-50/50 dark:hover:bg-stone-800/80 transition-colors">
                        <div class="flex items-center flex-1 min-w-0 flex-wrap gap-x-3 gap-y-1">
                            <span class="w-1.5 h-1.5 bg-emerald-800 dark:bg-teal-500 rounded-full transition-colors shrink-0"></span>
                            <span class="list-row-word font-japanese text-base font-semibold text-stone-800 dark:text-stone-200 tracking-wide transition-colors" lang="ja">${cleanWordFront}</span>
                            ${isGlobalScope ? `<span class="text-[10px] text-stone-500 dark:text-stone-300 bg-stone-100 dark:bg-stone-700/60 px-1.5 py-0.5 rounded-md shrink-0">${sourceNotebook} · ${item.mastered ? '已掌握' : '复习中'}</span>` : ''}
                            ${tagsHtmlList ? `<div class="flex flex-wrap gap-1 min-w-0">${tagsHtmlList}</div>` : ''}
                        </div>
                        <div class="flex items-center space-x-2.5 shrink-0">
                            ${editButtonHtml}
                            ${masterButtonHtml}
                            <svg class="w-4 h-4 text-stone-400 dark:text-stone-500 transition-transform duration-300 transform arrow-icon shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path>
                            </svg>
                        </div>
                    </div>

                    <div class="list-expand-area hidden border-t border-stone-100 dark:border-stone-700/50 bg-[#faf9f4]/80 dark:bg-stone-800/50 px-4 space-y-4 transition-colors">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div class="flex items-center space-x-2">
                                <span class="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider shrink-0 transition-colors">读音:</span>
                                <span class="font-japanese font-medium text-stone-900 dark:text-stone-100 leading-normal inline-block transition-colors" lang="ja">${rubyBack}</span>
                            </div>
                            <div class="flex items-center space-x-2">
                                <span class="text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-wider shrink-0 transition-colors">释义:</span>
                                <span class="text-stone-800 dark:text-stone-200 font-semibold px-2.5 py-1 bg-stone-200/40 dark:bg-stone-700/50 rounded-lg inline-block transition-colors">${item.meaning}</span>
                            </div>
                        </div>
                        ${item.example ? formatExample(item.example) : ''}
                    </div>
                </div>
            `;
        }
}

function updateLoadMoreControl(totalCardCount) {
    const container = document.getElementById('load-more-container');
    const status = document.getElementById('load-more-status');
    const manualBtn = document.getElementById('load-more-btn');
    const visibleCount = Math.min(visibleCardLimit, totalCardCount);

    if (totalCardCount === 0) {
        container.classList.add('hidden');
        container.classList.remove('flex');
        return;
    }

    // 状态行常驻：成为「到底了没」的明确路标，不再是一闪而过的幽灵按钮
    container.classList.remove('hidden');
    container.classList.add('flex');

    if (visibleCount >= totalCardCount) {
        status.textContent = `已全部显示 · 共 ${totalCardCount} 张卡片`;
        status.className = 'text-xs text-stone-400 dark:text-stone-500';
        if (manualBtn) manualBtn.classList.add('hidden');
    } else {
        status.textContent = `正在加载… 已显示 ${visibleCount} / ${totalCardCount} 张`;
        status.className = 'text-xs text-stone-400 dark:text-stone-500';
        // 手动按钮仅作兜底：IntersectionObserver 不可用等自动加载失效的环境
        if (manualBtn) manualBtn.classList.toggle('hidden', 'IntersectionObserver' in window);
    }
}

// ==========================================
// 📐 fit-to-card：卡片内容自适应缩放（从机制上消灭卡片滚动条）
// 原理：卡片盒子与网格轨道尺寸永远不变，只调节卡内字号系数；
// 逐卡测量正反两面 .card-content-scroll 是否溢出，溢出则每次 -0.05 直到刚好放下。
// 性能设计：① 固定盒子 = 无行对齐/无级联重排（与"改高度拉齐行"的卡顿方案本质不同）
// ② IntersectionObserver 只在卡片进入视口 ±200px 时处理，屏外卡片零成本
// ③ 滚动/缩放触发均为批处理，单次成本与卡片总数无关。
//
// ⚠️ 正面与背面使用两个互相独立的系数，必须分开测量（修复：背面长例句把正面单词压小）
//    正面 --fit-front：只看正面那个单词会不会放不下
//    背面 --fit-scale：看读音/释义/例句会不会放不下
//    早期版本共用一个 --fit-scale，导致"例句很长"的卡片把正面单词连带缩到 0.55 倍。
// ==========================================
const FIT_MIN_SCALE = 0.55;
const FIT_STEP = 0.05;
const FIT_VIEW_MARGIN = 200;
let fitObserver = null;
let fitRefitTimer = null;

function isScrollAreaOverflowing(area) {
    return area.scrollHeight > area.clientHeight + 1 || area.scrollWidth > area.clientWidth + 1;
}

// 对某一面的内容区域逐级缩小系数，直到不溢出或触底
function fitFace(card, selector, cssVar) {
    const areas = card.querySelectorAll(selector);
    if (areas.length === 0) return;
    let fit = 1;
    while (fit > FIT_MIN_SCALE) {
        let overflow = false;
        for (const area of areas) {
            if (isScrollAreaOverflowing(area)) { overflow = true; break; }
        }
        if (!overflow) break;
        fit = Math.max(FIT_MIN_SCALE, +(fit - FIT_STEP).toFixed(2));
        card.style.setProperty(cssVar, String(fit));
    }
}

function fitSingleCard(card) {
    try {
        card.style.setProperty('--fit-front', '1');
        card.style.setProperty('--fit-scale', '1');
        // 顺序无关：两面互不影响，各自只看自己那面的内容
        fitFace(card, '.card-front .card-content-scroll', '--fit-front');
        fitFace(card, '.card-back .card-content-scroll', '--fit-scale');
    } catch (err) {
        // 测量环境异常（极端缩放/隐藏标签页）时保持 1.0，绝不让适配逻辑破坏渲染
    }
}

function getFitObserver() {
    if (fitObserver) return fitObserver;
    fitObserver = new IntersectionObserver((entries) => {
        const entering = entries.filter(e => e.isIntersecting).map(e => e.target);
        if (entering.length) entering.forEach(fitSingleCard);
    }, { rootMargin: FIT_VIEW_MARGIN + 'px 0px' });
    return fitObserver;
}

// 渲染/追加新卡片后调用：为所有未观察的卡片登记懒适配（进视口才处理，每张卡只测一次状态）
function observeCardsForFit(container) {
    const scope = container || document.getElementById('cards-grid');
    if (!scope || layoutMode !== 'grid') return;
    const observer = getFitObserver();
    scope.querySelectorAll('.perspective').forEach(card => {
        if (!card.dataset.fitBound) {
            card.dataset.fitBound = '1';
            observer.observe(card);
        }
    });
}

// 对当前视口 ±200px 内的卡片立即重适配（滑块变化、字体加载完成后调用）
function fitCardsInViewport() {
    const grid = document.getElementById('cards-grid');
    if (!grid || layoutMode !== 'grid') return;
    const vh = window.innerHeight;
    const pending = [];
    grid.querySelectorAll('.perspective').forEach(card => {
        const rect = card.getBoundingClientRect();
        if (rect.bottom > -FIT_VIEW_MARGIN && rect.top < vh + FIT_VIEW_MARGIN) pending.push(card);
    });
    pending.forEach(fitSingleCard);
}

// 防抖批处理：拖动滑块时合并高频触发
function scheduleRefit() {
    if (fitRefitTimer) clearTimeout(fitRefitTimer);
    fitRefitTimer = setTimeout(fitCardsInViewport, 120);
}

window.loadMoreCards = function() {
    const grid = document.getElementById('cards-grid');
    const { filteredList, isGlobalScope } = getDisplayedCards();
    const prevLimit = visibleCardLimit;
    visibleCardLimit = Math.min(visibleCardLimit + cardsPerBatch, filteredList.length);
    const newCards = filteredList.slice(prevLimit, visibleCardLimit);
    if (newCards.length > 0) {
        grid.insertAdjacentHTML('beforeend', newCards.map(item => buildCardHtml(item, isGlobalScope)).join(''));
        observeCardsForFit();
    }
    updateLoadMoreControl(filteredList.length);
    updateHeaderCount();
}

window.flipCard = function(element) {
    const inner = element.querySelector('.card-inner');
    const flipped = inner.classList.toggle('is-flipped');
    const id = element.dataset.cardId;
    if (id) { if (flipped) flippedCardIds.add(id); else flippedCardIds.delete(id); }
}

// ==========================================
// ✏️ 重构逻辑：编辑卡片区 (合并了 Move)
// ==========================================
let currentEditTags = [];

window.openEditCardModal = function(event, cardId, notebookName = activeNotebook) {
    event.stopPropagation();

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

    // 修改下拉框逻辑：展示所有本子，默认选中当前
    const targetSelect = document.getElementById('edit-move-target');
    const targets = Object.keys(notebooks);
    targetSelect.innerHTML = targets.map(name => `<option value="${name}">${name}</option>`).join('');
    targetSelect.value = notebookName;

    const modal = document.getElementById('edit-card-modal');
    modal.classList.remove('hidden');
}

window.closeEditCardModal = function() {
    const modal = document.getElementById('edit-card-modal');
    modal.classList.add('hidden');
}

function renderEditTags() {
    const container = document.getElementById('edit-tags-container');
    // 已选中标签统一颜色，与主界面对齐
    container.innerHTML = currentEditTags.map((tag, index) => `
        <span class="inline-flex items-center gap-1 px-2 py-1 bg-emerald-800/[0.12] dark:bg-teal-300/[0.12] text-emerald-800 dark:text-teal-300 rounded text-xs font-medium">
            ${tag}
            <button type="button" onclick="removeEditTag(${index})" class="hover:text-emerald-950 dark:hover:text-teal-100 focus:outline-none ml-0.5">&times;</button>
        </span>
    `).join('');
    renderEditTagSuggestions();
}

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
    label.className = 'text-[11px] text-stone-400 dark:text-stone-500 self-center shrink-0 pr-1';
    label.textContent = '历史标签：';
    box.appendChild(label);

    getOrderedTags(getTagCounts()).filter(tag => allTags.has(tag)).forEach(tag => {
        const chip = document.createElement('button');
        chip.type = 'button';
        // 【重构】历史标签彻底降噪，去掉虚线框、绿字、+号，变成安静的灰色小胶囊
        chip.className = 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-stone-100 dark:bg-stone-800/80 text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors border border-transparent';
        chip.textContent = tag;
        chip.addEventListener('click', () => {
            if (!currentEditTags.includes(tag)) {
                currentEditTags.push(tag);
                renderEditTags();
            }
        });
        box.appendChild(chip);
    });
}

window.removeEditTag = function(index) {
    currentEditTags.splice(index, 1);
    renderEditTags();
}

document.getElementById('edit-tag-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = this.value.trim().replace(/^,+|,+$/g, '');
        if (val && !currentEditTags.includes(val)) {
            currentEditTags.push(val);
            renderEditTags();
        }
        this.value = '';
    }
});

// ⌨️ 快捷键：焦点在单词输入框时按 Ctrl+Enter（Mac 为 Cmd+Enter）触发「匹配假名」，
// 免去摸鼠标点按钮。isComposing 判断保证日文输入法组合期间不误触。
['input-word', 'edit-word'].forEach(id => {
    const wordInput = document.getElementById(id);
    if (!wordInput) return;
    wordInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
            e.preventDefault();
            autoLookupWord(id === 'edit-word');
        }
    });
});

// ⌨️ 例句框：Enter 直接提交添加（Shift+Enter 换行）。isComposing 判断保证
// 日文输入法选字期间的回车不会误提交。
document.getElementById('input-example').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        document.getElementById('vocab-form').requestSubmit();
    }
});

// 统一提交：内容保存与移动合并一处
document.getElementById('edit-vocab-form').addEventListener('submit', function(e) {
    e.preventDefault();

    const cardId = document.getElementById('edit-card-id').value;
    const editNotebook = document.getElementById('edit-card-notebook').value || activeNotebook;
    const targetNotebook = document.getElementById('edit-move-target').value;

    const currentList = notebooks[editNotebook] || [];
    const cardIndex = currentList.findIndex(c => c.id === cardId);

    if (cardIndex > -1) {
        const card = currentList[cardIndex];
        const updatedWord = document.getElementById('edit-word').value.trim();

        if (hasGlobalDuplicate(updatedWord, card.id)) {
            showToast('全局单词库中已存在同一个单词，无法保存。');
            return;
        }

        card.word = updatedWord;
        card.kana = document.getElementById('edit-kana').value.trim();
        card.meaning = document.getElementById('edit-meaning').value.trim();
        card.example = document.getElementById('edit-example').value.trim();
        card.tags = [...currentEditTags];

        // 核心：如果有跨本子移动的动作
        if (targetNotebook && targetNotebook !== editNotebook) {
            currentList.splice(cardIndex, 1);
            if (!notebooks[targetNotebook]) notebooks[targetNotebook] = [];
            notebooks[targetNotebook].unshift(card);
        }

        saveData();
        renderNotebookTabs();
        renderCards();
        closeEditCardModal();

        if (targetNotebook && targetNotebook !== editNotebook) {
            showToast(`卡片已保存，并移动到【${targetNotebook}】单词本。`);
        } else {
            showToast("卡片内容及标签保存成功！");
        }
    }
});

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

/* ============================================================
   点击音效：标记「已掌握」时播放清脆一声（WebAudio 合成，无需素材文件）
   ============================================================ */
// 默认开启；存 localStorage，可被顶部喇叭开关覆盖
let soundEnabled = (localStorage.getItem('sound_enabled') !== 'false');

let _audioCtx = null;
function getAudioCtx() {
    if (!_audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        _audioCtx = new AC();
    }
    // 浏览器要求用户手势后才能出声；标记已掌握本身就是一次点击，自动 resume 即可
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

// 圆润清脆的「铜磬/引磬」金属声：全高频非整数泛音 + 温和失谐拍频 + 柔和起音 + 短促余韵
function playCrispClick() {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.22;            // 高音泛音多，整体压低防止削波
    master.connect(ctx.destination);

    const f0 = 3180;   // 小铜磬基频，音区高、通透明亮 —— 回到原本认可的清脆版

    // 小铜磬（引磬）的清脆金属泛音：全部落在高频区，砍掉低频「哼音」所以不闷；
    // 非整数倍 + 温和失谐拍频 -> 清凌凌的金属微闪，余韵稍长更圆润。
    // 圆润化：最高频泛音压低、基频尾音略拉长，整体温润不刮耳。
    // [相对基频, 幅度, 衰减时长(秒), 失谐比例]
    const partials = [
        [1.00, 1.00, 1.85, 1.0015],  // 基频（主体）—— 尾音略拉长，更圆润
        [1.35, 0.48, 1.50, 1.0020],  // 金属泛音，温和拍频带来脆响的活感
        [1.78, 0.38, 1.15, 1.0025],  // 
        [2.28, 0.26, 0.85, 1.0000],  // 高频闪耀
        [2.95, 0.18, 0.62, 1.0000],  // 
        [3.72, 0.10, 0.46, 1.0000],  // 极高频压低，减少刮耳感
        [4.60, 0.06, 0.34, 1.0000]   // 极高频光泽（弱）
    ];

    partials.forEach(([ratio, amp, dur, detune]) => {
        const freq = f0 * ratio;
        // 主振荡器：起音略高、柔和落定，金属自由振动 -> 圆润不刮
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq * 1.004, now);
        o.frequency.exponentialRampToValueAtTime(freq, now + 0.03);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(amp, now + 0.010);          // 柔和起音 -> 圆润
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);          // 温润余韵
        o.connect(g).connect(master);
        o.start(now); o.stop(now + dur + 0.05);

        // 失谐副本：与主音相差几赫兹，产生缓慢拍频 -> 清凌凌的金属微闪
        if (detune > 1.0) {
            const o2 = ctx.createOscillator();
            o2.type = 'sine';
            o2.frequency.setValueAtTime(freq * detune * 1.004, now);
            o2.frequency.exponentialRampToValueAtTime(freq * detune, now + 0.03);
            const g2 = ctx.createGain();
            g2.gain.setValueAtTime(0.0001, now);
            g2.gain.exponentialRampToValueAtTime(amp * 0.7, now + 0.010);
            g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            o2.connect(g2).connect(master);
            o2.start(now); o2.stop(now + dur + 0.05);
        }
    });

    // 槌击瞬态：极短、极轻的高通白噪声，给细金属槌敲击那一下「嗒」的真实感（压低更圆润）
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.02), ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    ns.connect(hp).connect(ng).connect(master);
    ns.start(now); ns.stop(now + 0.02);
}

window.toggleSoundEnabled = function() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('sound_enabled', soundEnabled ? 'true' : 'false');
    updateSoundIcon();
    if (soundEnabled) playCrispClick(); // 打开时预览一声
};

function updateSoundIcon() {
    const on = document.getElementById('sound-icon-on');
    const off = document.getElementById('sound-icon-off');
    if (!on || !off) return;
    if (soundEnabled) {
        on.classList.remove('hidden');
        off.classList.add('hidden');
    } else {
        on.classList.add('hidden');
        off.classList.remove('hidden');
    }
}

// 标记「已掌握」成功时的浮层小动效：点击处弹出「✓ 已掌握」徽标，
// 弹性缩放入场 + 柔光，约 0.72s 后淡出上浮。用 fixed 定位脱离卡片重渲染，
// 因此「复习中」视图下卡片消失也能稳定显示；iPhone 无网页震动，此即替补奖励通道。
function spawnMasteredPop(x, y) {
    const el = document.createElement('div');
    el.className = 'mastered-pop';
    el.innerHTML = '<span class="mp-check">✓</span><span>已掌握</span>';
    el.style.left = (x || window.innerWidth / 2) + 'px';
    el.style.top = ((y || 80) - 26) + 'px';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => { if (el.parentNode) el.remove(); }, 1400); // 兜底清理（须晚于动画时长 1.1s）
}

window.toggleCardMastered = function(event, cardId, notebookName = activeNotebook) {
    event.stopPropagation();

    const currentList = notebooks[notebookName] || [];
    const card = currentList.find(c => c.id === cardId);

    if (card) {
        const oldStatus = card.mastered;
        if (!oldStatus) {
            playCrispClick();              // 放入「已掌握」时清脆一声
            spawnMasteredPop(event.clientX, event.clientY); // 视觉奖励（iPhone 震动替补）
            // 安卓震动（双脉冲对应「叮—咚」）；iPhone 不支持 navigator.vibrate，静默跳过。受静音开关控制。
            if (soundEnabled && navigator.vibrate) navigator.vibrate([18, 40, 26]);
        }
        card.mastered = !card.mastered;
        if (card.mastered) card.masteredAt = Date.now(); // 记录掌握时间，用于已掌握视图按时间倒序
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

window.openAiSettingsModal = function() {
    const modal = document.getElementById('ai-settings-modal');
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

    localStorage.setItem('ai_provider', selectedProvider);
    localStorage.setItem('gemini_api_key', geminiKey);
    localStorage.setItem('deepseek_api_key', deepseekKey);

    closeAiSettingsModal();
    showToast(`⚙️ AI服务商配置成功！当前激活：${selectedProvider === 'gemini' ? 'Google Gemini' : 'DeepSeek API'}`);
}

let currentBatchImageBase64 = null;
let currentBatchImageMimeType = null;

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
    document.getElementById('json-import-textarea').value = "";
    document.getElementById('json-file-upload').value = "";
    document.getElementById('json-import-preview').classList.add('hidden');
    document.getElementById('json-import-submit-btn').disabled = true;
    document.getElementById('json-new-notebook-name').value = "";
    document.querySelector('input[name="json-target"][value="current"]').checked = true;
    document.getElementById('json-target-current-name').innerText = activeNotebook;
    switchBatchTab('ai');
    document.getElementById('batch-import-modal').classList.remove('hidden');
}

window.closeBatchImportModal = function() {
    document.getElementById('batch-import-modal').classList.add('hidden');
}

window.switchBatchTab = function(tab) {
    const aiPane = document.getElementById('batch-pane-ai');
    const jsonPane = document.getElementById('batch-pane-json');
    const aiTab = document.getElementById('batch-tab-ai');
    const jsonTab = document.getElementById('batch-tab-json');
    const activeCls = ['bg-white', 'dark:bg-stone-700', 'text-emerald-800', 'dark:text-teal-400', 'shadow-sm'];
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

function parseVocabPack(text) {
    const data = JSON.parse(text);
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
        const nameInput = document.getElementById('json-new-notebook-name');
        if (parsed.suggestedName && !nameInput.value.trim()) {
            nameInput.value = parsed.suggestedName;
        }
    } catch (e) {
        preview.classList.add('hidden');
        submitBtn.disabled = true;
    }
}

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
        switchNotebook(targetName);
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

            const promptText = systemPrompt + "\n\n要处理的内容说明：\n" + (textVal || "请精准识别随附图片中的日语内容并提取。");
            const payloadParts = [{ text: promptText }];

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

        if (!notebooks[activeNotebook]) notebooks[activeNotebook] = [];
        let successCount = 0;
        let dupCount = 0;

        const getCleanWord = (w) => w.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$1');

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
            if (textJson) {
                 textJson = textJson.replace(/```json/g, '').replace(/```/g, '').trim();
            }
        } else {
            textJson = responseData.choices?.[0]?.message?.content;
        }

        if (!textJson) throw new Error("AI未能输出合法的回包字段");

        const data = JSON.parse(textJson);

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
    statusEl.className = `text-center text-xs font-semibold py-2 ${isError ? 'text-danger-600 dark:text-danger-400' : 'text-emerald-600 dark:text-teal-500'}`;
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
        notebooks: notebooks,
        // 标签的自定义顺序（老备份没有这个字段，恢复时按"未排序"处理即可）
        tagOrder: tagOrder || []
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
            // 兼容旧备份：没有 tagOrder 字段就保持本地现状，不当成"顺序被清空"
            if (Array.isArray(parsedData.tagOrder)) {
                tagOrder = parsedData.tagOrder;
                saveTagOrder();
            }
            saveData();
            renderNotebookTabs();
            renderGlobalTags();
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
        btn.innerHTML = `<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg><span>⬇️ 从云端拉取并恢复本地</span>`;
    }
}

document.getElementById('vocab-form').addEventListener('submit', function(e) {
    e.preventDefault();

    const wordInput = document.getElementById('input-word');
    const kanaInput = document.getElementById('input-kana');
    const meaningInput = document.getElementById('input-meaning');
    const exampleInput = document.getElementById('input-example');

    const wordVal = wordInput.value.trim();

    if (!notebooks[activeNotebook]) {
        notebooks[activeNotebook] = [];
    }

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
        tags: []
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

document.getElementById('search-input').addEventListener('input', function(event) {
    window.clearTimeout(searchDebounceTimer);
    const isSearching = event.target.value.trim() !== '';
    const wasSearching = this.dataset.wasSearching === '1';

    if (isSearching && !wasSearching) {
        activeTagFilters = [];
        renderGlobalTags();
        setCardFilter("all");
    } else if (!isSearching && wasSearching) {
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

let allFlipped = false;
// 翻面状态（内存中按 cardId 记录）。renderCards 重绘后据此回灌 .card-inner.is-flipped，
// 使标记已掌握等触发整页重绘的操作不再把已翻面的卡片刷回正面。刷新页面时重置（符合「保持原样」的会话内语义）。
const flippedCardIds = new Set();
// 悬浮翻面按钮：平铺模式=全卡翻面↔还原正面；列表模式=全部展开↔收起（自愈式：
// 只要还有没收起的条目就全部展开，全部展开过再按才全部收起，不会卡中间态）
const flipFab = document.getElementById('flip-fab');
if (flipFab) {
    flipFab.addEventListener('click', () => {
        if (layoutMode === "grid") {
            allFlipped = !allFlipped;
            document.querySelectorAll('.card-scale-box').forEach(box => {
                const id = box.dataset.cardId;
                const inner = box.querySelector('.card-inner');
                if (allFlipped) { if (id) flippedCardIds.add(id); } else { if (id) flippedCardIds.delete(id); }
                if (inner) inner.classList.toggle('is-flipped', allFlipped);
            });
            flipFab.title = allFlipped ? "全部还原正面" : "全卡翻面";
        } else {
            const areas = document.querySelectorAll('.list-expand-area');
            if (areas.length === 0) return;
            const anyCollapsed = Array.prototype.some.call(areas, a => a.classList.contains('hidden'));
            // anyCollapsed=true → 全部展开（移除 hidden）；false → 全部收起（加上 hidden）
            areas.forEach(a => a.classList.toggle('hidden', !anyCollapsed));
            document.querySelectorAll('.arrow-icon').forEach(icon => {
                icon.classList.toggle('rotate-180', anyCollapsed);
            });
            flipFab.title = anyCollapsed ? "全部收起" : "全部展开";
        }
    });
}

window.shuffleCards = function() {
    const currentList = notebooks[activeNotebook] || [];
    if (currentList.length <= 1) {
        showToast("当前本里只有一个单词，不用打乱哦！");
        return;
    }
    const hadManual = manualCardOrder;
    reshuffleDisplay();
    showToast(hadManual
        ? "顺序已重新打乱，之前手动排的顺序已清除 🎲"
        : "顺序已打乱！快开始新一轮复习吧 🎲");
}

window.exportToMD = function() {
    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    if (filteredList.length === 0) {
        showToast("当前界面没有可以导出的单词！");
        return;
    }
    const { flat: outList, groups } = applyExportSort(filteredList);

    const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

    let scopeName = activeNotebook;
    if (isGlobalScope) {
        const parts = [];
        if (activeTagFilters.length > 0) parts.push(`标签·${activeTagFilters.join("·")}`);
        if (isGlobalSearch) parts.push("搜索结果");
        scopeName = parts.join("·");
    }
    const safeScopeName = scopeName.replace(/[\\\/:*?"<>|]/g, '_');

    const sanitizeMdCell = (text) => String(text || '')
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

    let mdContent = `# 📓 日语单词自测练习表 (${scopeName})\n\n`;
    mdContent += `- **导出范围**: ${scopeName}${isGlobalScope ? '（跨单词本）' : ''}\n`;
    mdContent += `- **导出日期**: ${dateStr}\n`;
    mdContent += `- **生词总数**: ${outList.length} 词\n`;
    mdContent += `- **排序方式**: ${EXPORT_SORT_LABEL[exportSortMode]}\n\n`;
    mdContent += `---\n\n`;
    mdContent += `> **💡 背诵建议**：你可以直接将此文件导入 Obsidian、Notion 或任何支持 Markdown 的编辑器中进行背诵复习，也可以直接在笔记软件中将其输出为 PDF 打印成纸质版。最右侧的 [ 默写与自测备注栏 ] 保持空白，专门留给你进行手写自测和错词标记。\n\n`;

    const mdRow = (item) => {
        let cleanWord = sanitizeMdCell(item.word).replace(/</g, "&lt;").replace(/>/g, "&gt;");

        let formattedWord = cleanWord;
        const bracketRegex = rubyBracketRegex();

        if (bracketRegex.test(cleanWord)) {
            bracketRegex.lastIndex = 0;
            formattedWord = cleanWord.replace(bracketRegex, '<ruby>$1<rt>$2</rt></ruby>');
        } else if (item.kana && item.kana.trim() !== "") {
            let cleanKana = sanitizeMdCell(item.kana).trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
            formattedWord = `<ruby>${cleanWord}<rt>${cleanKana}</rt></ruby>`;
        }

        let wordCol = formattedWord;

        let cleanMeaning = sanitizeMdCell(item.meaning).replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        let meaningCol = `${cleanMeaning}`;
        if (item.example) {
            let cleanExample = sanitizeMdCell(item.example).replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            meaningCol += `<br><span style="font-size: 0.85em; color: #78716c;">*例句: ${cleanExample}*</span>`;
        }

        mdContent += `| ${wordCol} | ${meaningCol} |  |\n`;
    };

    // 按标签分组档：每组前插一个三级标题，其余档就是一张平表
    if (groups) {
        groups.forEach(g => {
            mdContent += `### 🏷️ ${g.label}（${g.items.length} 词）\n\n`;
            mdContent += `| 单词与假名 | 中文释义与例句 | 默写/自测备注栏 |\n`;
            mdContent += `| :--- | :--- | :--- |\n`;
            g.items.forEach(mdRow);
            mdContent += `\n`;
        });
    } else {
        mdContent += `| 单词与假名 | 中文释义与例句 | 默写/自测备注栏 |\n`;
        mdContent += `| :--- | :--- | :--- |\n`;
        outList.forEach(mdRow);
    }

    try {
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

window.exportToJSON = function() {
    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    if (filteredList.length === 0) {
        showToast("当前界面没有可以导出的单词！");
        return;
    }
    const { flat: outList } = applyExportSort(filteredList);

    let scopeName = activeNotebook;
    if (isGlobalScope) {
        const parts = [];
        if (activeTagFilters.length > 0) parts.push(`标签·${activeTagFilters.join("·")}`);
        if (isGlobalSearch) parts.push("搜索结果");
        scopeName = parts.join("·");
    }
    const safeScopeName = scopeName.replace(/[\\\/:*?"<>|]/g, '_');

    const pack = {
        format: "vocab-pack",
        version: 1,
        scope: scopeName,
        exportedAt: new Date().toISOString().slice(0, 10),
        sort: EXPORT_SORT_LABEL[exportSortMode],
        cards: outList.map(item => ({
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
        showToast(`📦 JSON 单词包导出成功（${pack.cards.length} 个单词，${EXPORT_SORT_LABEL[exportSortMode]}），可分享给他人导入！`);
    } catch (err) {
        showToast("导出失败，请检查浏览器隐私及下载设置。");
    }
}

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('export-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        document.getElementById('export-menu').classList.add('hidden');
    }
});

window.exportToPDF = function() {
    const { filteredList, isGlobalSearch, isGlobalScope } = getDisplayedCards();
    if (filteredList.length === 0) {
        showToast("当前界面没有可以导出的单词！");
        return;
    }
    const { flat: outList, groups } = applyExportSort(filteredList);

    let scopeName = activeNotebook;
    if (isGlobalScope) {
        const parts = [];
        if (activeTagFilters.length > 0) parts.push(`标签·${activeTagFilters.join("·")}`);
        if (isGlobalSearch) parts.push("搜索结果");
        scopeName = parts.join("·");
    }
    const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

    const escHtml = (text) => String(text || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const toRuby = (word, kana) => {
        const safe = escHtml(word);
        const bracketRegex = rubyBracketRegex();
        if (bracketRegex.test(safe)) {
            bracketRegex.lastIndex = 0;
            return safe.replace(bracketRegex, '<ruby>$1<rt>$2</rt></ruby>');
        }
        if (kana && kana.trim() !== "") {
            return `<ruby>${safe}<rt>${escHtml(kana.trim())}</rt></ruby>`;
        }
        return safe;
    };

    const pdfRow = (item) => {
        let wordCell = toRuby(item.word, item.kana);
        let meaningCell = escHtml(item.meaning);
        if (item.example) {
            const exampleLines = String(item.example).split(/[/／\n]+/).map(s => s.trim()).filter(Boolean);
            exampleLines.forEach((line, idx) => {
                meaningCell += `<br><span class="example-note font-japanese">${exampleLines.length > 1 ? `${toCircledNum(idx + 1)} ` : ''}${escHtml(line)}</span>`;
            });
        }
        return `<tr><td class="word-col font-japanese">${wordCell}</td><td>${meaningCell}</td><td class="write-col"></td></tr>`;
    };

    // 分组档用一行通栏的浅色小标题隔开，视觉上等于 Markdown 里的 ### 分组标题
    const groupRowHtml = (g) =>
        `<tr class="group-row"><td colspan="3">🏷️ ${escHtml(g.label)}（${g.items.length} 词）</td></tr>`;

    const rowsHtml = groups
        ? groups.map(g => groupRowHtml(g) + '\n' + g.items.map(pdfRow).join('\n')).join('\n')
        : outList.map(pdfRow).join('\n');

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
    th { background: #e7e5e4; font-size: 9.5pt; letter-spacing: 1pt; }
    tbody tr:nth-child(even) { background: #f5f5f4; }
    td.word-col { width: 34%; }
    td.write-col { width: 24%; }
    ruby { ruby-align: center; }
    rt { font-size: 0.55em; color: #8c7e6c; letter-spacing: 0; }
    .source-note { font-size: 7.5pt; color: #a8a29e; }
    .example-note { font-size: 8.5pt; color: #78716c; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    tr.group-row td { background: #efeae1; font-size: 9.5pt; font-weight: 700; letter-spacing: 1pt; color: #57534e; page-break-after: avoid; }
    .print-tip { text-align: center; font-size: 9pt; color: #78716c; margin: 12pt 0 0; }
    @media print { .print-tip { display: none; } }
</style>
</head>
<body>
    <h1>📓 日语单词自测练习表</h1>
    <div class="meta">
<span><b>导出范围</b>：${escHtml(scopeName)}${isGlobalScope ? '（跨单词本）' : ''}</span>
<span><b>导出日期</b>：${escHtml(dateStr)}</span>
<span><b>生词总数</b>：${outList.length} 词</span><span><b>排序</b>：${escHtml(EXPORT_SORT_LABEL[exportSortMode])}</span>
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

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast("❌ 弹出打印窗口被浏览器拦截，请允许本页面的弹出式窗口后重试。");
        return;
    }
    printWindow.document.open();
    printWindow.document.write(printDoc);
    printWindow.document.close();
    printWindow.onload = () => {
        setTimeout(() => { printWindow.focus(); printWindow.print(); }, 200);
    };

    showToast("🖨️ 已生成打印版练习表，在打印对话框中选择「另存为 PDF」即可！");
}

window.onload = function() {
    loadData();
}
// 卡片拖拽排序：事件委托挂在 document 上，卡片重渲染后不必重新绑定
initCardDragSort();
const backToTopBtn = document.getElementById('back-to-top-btn');
const shuffleFab = document.getElementById('shuffle-fab');
const updateBackToTopButton = () => {
    const visible = window.scrollY > 360;
    backToTopBtn.classList.toggle('is-visible', visible);
    if (shuffleFab) shuffleFab.classList.toggle('is-visible', visible);
    if (flipFab) flipFab.classList.toggle('is-visible', visible);
};
window.addEventListener('scroll', updateBackToTopButton, { passive: true });
backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
updateBackToTopButton();

if (shuffleFab) {
    shuffleFab.addEventListener('click', () => {
        const { filteredList } = getDisplayedCards();
        if (filteredList.length <= 1) {
            showToast("当前视图里只有一个单词，不用打乱哦！");
            return;
        }
        const hadManual = manualCardOrder;
        reshuffleDisplay();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast(hadManual
            ? "顺序已重新打乱，之前手动排的顺序已清除 🎲"
            : "顺序已打乱！快开始新一轮复习吧 🎲");
    });
}

const loadMoreSentinel = document.getElementById('load-more-container');
if ('IntersectionObserver' in window && loadMoreSentinel) {
    const loadMoreObserver = new IntersectionObserver((entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        const { filteredList } = getDisplayedCards();
        if (visibleCardLimit < filteredList.length) {
            loadMoreCards();
        }
    }, { rootMargin: '600px' });
    loadMoreObserver.observe(loadMoreSentinel);
}

function setupInputClearButtons() {
    const fields = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="range"]):not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]), textarea');

    fields.forEach((field) => {
        if (field.dataset.clearButtonReady === 'true') return;
        field.dataset.clearButtonReady = 'true';

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.tabIndex = -1; // 移出 Tab 顺序：Tab 只在输入框之间跳转，清空用鼠标点击
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
            // ⚠️ 输入框是 inline-block，自身的上下外边距会计入父级行盒高度（如重命名框的 mb-5
            // 会把 50px 的包裹层撑到 70px），使清空按钮的 top:50% 定位偏低 10px。
            // 因此把上下外边距原样转移到包裹层，输入框自身归零，视觉间距不变、居中恢复准确。
            const fieldStyle = getComputedStyle(field);
            wrapper.style.marginTop = fieldStyle.marginTop;
            wrapper.style.marginBottom = fieldStyle.marginBottom;
            field.style.marginTop = '0';
            field.style.marginBottom = '0';
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
            if (field.id === 'search-input') {
                window.setTimeout(notifyFieldChange, 32);
            } else {
                notifyFieldChange();
            }
        };
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

// 网络字体（Noto Sans JP）加载完成后字宽会变，重测一次可见卡片，避免首测偏差
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scheduleRefit());
}

// 初始化点击音效开关图标（依据 localStorage 中的 sound_enabled）
updateSoundIcon();

