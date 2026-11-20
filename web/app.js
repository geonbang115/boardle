(() => {
  const MAX_ATTEMPTS = 5;
  const DAILY_EPOCH = "2026-11-20"; // #1 issue date
  const CHOSEONG = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"
  ];

  const ATTR_DEFS = [
    { key: "year", label: "출시 연도", format: (g) => `${g.year}년` },
    { key: "diff", label: "난이도", format: (g) => `${g.diff.toFixed(2)} / 5` },
    { key: "minP", label: "최소 인원", format: (g) => `${g.minP}명` },
    { key: "maxP", label: "최대 인원", format: (g) => `${g.maxP}명` },
    { key: "time", label: "플레이 타임", format: (g) => g.timeStr },
    { key: "mech", label: "메커니즘", format: (g) => (g.mech.length ? g.mech.join(", ") : "-") },
    { key: "theme", label: "테마", format: (g) => (g.theme.length ? g.theme.join(", ") : "-") },
  ];

  const TIER_LABELS = {
    easy: "쉬움 (Top 150 + 파티50)",
    normal: "보통 (데일리 풀)",
    hard: "어려움 (한글 전체)",
  };

  const ALL_GAMES = Array.isArray(window.BGG_GAMES) ? window.BGG_GAMES : [];
  const GAMES_BY_ID = new Map(ALL_GAMES.map((g) => [g.id, g]));

  const createEmptyHints = () => ({
    choseongCount: 0,
    designer: false,
    art: false,
    attrs: {},
  });

  const state = {
    mode: "daily", // "daily" | "endless"
    dailyDateKey: "",
    endlessPool: "normal",
    target: null,
    guesses: [],
    status: "playing", // "playing" | "won" | "lost"
    continueAfterLoss: false,
    revealedAnswer: false,
    attrPickerOpen: false,
    hints: createEmptyHints(),
    statsTab: "daily", // "daily" | "endless" | "global"
    acIndex: -1,
    acResults: [],
  };

  // DOM Elements
  const el = {
    issueBadge: document.getElementById("daily-issue-badge"),
    btnDaily: document.getElementById("btn-mode-daily"),
    btnEndless: document.getElementById("btn-mode-endless"),
    btnArchive: document.getElementById("btn-archive"),
    poolSelect: document.getElementById("pool-select"),
    btnNewGame: document.getElementById("btn-new-game"),
    btnHelp: document.getElementById("btn-help"),
    btnStats: document.getElementById("btn-stats"),
    searchInput: document.getElementById("search-input"),
    acList: document.getElementById("autocomplete-list"),
    attemptCounter: document.getElementById("attempt-counter"),
    hintCounter: document.getElementById("hint-counter"),
    endlessStreakBadge: document.getElementById("endless-streak-badge"),
    btnHintChoseong: document.getElementById("btn-hint-choseong"),
    btnHintDesigner: document.getElementById("btn-hint-designer"),
    btnHintArt: document.getElementById("btn-hint-art"),
    btnHintAttrToggle: document.getElementById("btn-hint-attr-toggle"),
    attrPicker: document.getElementById("attr-picker"),
    attrPickerList: document.getElementById("attr-picker-list"),
    clueBoard: document.getElementById("clue-board"),
    clueMechList: document.getElementById("clue-mech-list"),
    clueThemeList: document.getElementById("clue-theme-list"),
    hintDisplay: document.getElementById("hint-display"),
    resultBanner: document.getElementById("result-banner"),
    btnCriteriaHelp: document.getElementById("btn-criteria-help"),
    criteriaPanel: document.getElementById("criteria-panel"),
    guessTbody: document.getElementById("guess-tbody"),
    emptyState: document.getElementById("empty-state"),
    modalHelp: document.getElementById("modal-help"),
    modalStats: document.getElementById("modal-stats"),
    modalArchive: document.getElementById("modal-archive"),
    archiveList: document.getElementById("archive-list"),
    tabStatsDaily: document.getElementById("tab-stats-daily"),
    tabStatsEndless: document.getElementById("tab-stats-endless"),
    tabStatsGlobal: document.getElementById("tab-stats-global"),
    statsBody: document.getElementById("stats-body"),
    toast: document.getElementById("toast"),
  };

  // Date Helpers
  function formatDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getTodayKey() {
    return formatDateKey(new Date());
  }

  function parseDateKey(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function getPrevDateKey(dateKey) {
    const d = parseDateKey(dateKey);
    d.setDate(d.getDate() - 1);
    return formatDateKey(d);
  }

  function getIssueNumber(dateKey) {
    const start = parseDateKey(DAILY_EPOCH);
    const cur = parseDateKey(dateKey);
    const diffDays = Math.round((cur - start) / 86400000);
    return Math.max(1, diffDays + 1);
  }

  function getAllArchiveDateKeys() {
    const keys = [];
    const today = getTodayKey();
    let cur = parseDateKey(DAILY_EPOCH);
    const end = parseDateKey(today);
    if (cur > end) return [today];
    while (cur <= end) {
      keys.push(formatDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return keys.reverse(); // Newest first
  }

  function getClientId() {
    try {
      let cid = localStorage.getItem("boardle_client_id_v1");
      if (!cid) {
        cid = (crypto.randomUUID ? crypto.randomUUID() : `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
        localStorage.setItem("boardle_client_id_v1", cid);
      }
      return cid;
    } catch {
      return `anon_${Date.now()}`;
    }
  }

  // Supabase Integration
  function getSupabaseConfig() {
    const cfg = window.BOARDLE_SUPABASE;
    if (!cfg || !cfg.url || !cfg.anonKey) return null;
    return { url: cfg.url.replace(/\/$/, ""), anonKey: cfg.anonKey };
  }

  async function logPlayToSupabase({ dateKey, mode, won, attempts, hints }) {
    const cfg = getSupabaseConfig();
    if (!cfg) return;
    try {
      await fetch(`${cfg.url}/rest/v1/play_logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          client_id: getClientId(),
          date_key: dateKey,
          mode,
          won: Boolean(won),
          attempts,
          hints,
        }),
      });
    } catch {
      // Non-blocking analytics failure
    }
  }

  async function fetchGlobalStats() {
    const cfg = getSupabaseConfig();
    if (!cfg) return { configured: false };
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/play_logs?select=client_id,date_key,mode,won,attempts,hints&limit=5000`,
        {
          headers: {
            apikey: cfg.anonKey,
            Authorization: `Bearer ${cfg.anonKey}`,
          },
        }
      );
      if (!res.ok) return { configured: true, error: true };
      const rows = await res.json();
      const today = getTodayKey();
      const uniquePlayers = new Set(rows.map((r) => r.client_id)).size;
      const totalPlays = rows.length;
      const totalWins = rows.filter((r) => r.won).length;
      const winRate = totalPlays > 0 ? Math.round((totalWins / totalPlays) * 100) : 0;

      const todayRows = rows.filter((r) => r.mode === "daily" && r.date_key === today);
      const todayWins = todayRows.filter((r) => r.won).length;
      const todayRate = todayRows.length > 0 ? Math.round((todayWins / todayRows.length) * 100) : 0;

      const winRows = rows.filter((r) => r.won);
      const avgHints =
        winRows.length > 0
          ? (winRows.reduce((acc, r) => acc + (Number(r.hints) || 0), 0) / winRows.length).toFixed(1)
          : "0.0";

      return {
        configured: true,
        uniquePlayers,
        totalPlays,
        winRate,
        todayPlays: todayRows.length,
        todayRate,
        avgHints,
      };
    } catch {
      return { configured: true, error: true };
    }
  }

  // Hashing & Target Selection
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getAnswerPool(tier = "normal") {
    return ALL_GAMES.filter((g) => {
      if (!g.hasKr) return false;
      if (tier === "easy") {
        return g.blRank <= 150 || g.bggRank <= 150 || g.partyRank <= 50;
      }
      if (tier === "normal") {
        return g.blRank <= 500 || g.bggRank <= 500 || g.partyRank <= 150 || g.familyRank <= 200;
      }
      return true;
    });
  }

  function pickDailyTarget(dateKey) {
    const pool = getAnswerPool("normal");
    const idx = hashString(`boardle-kr-${dateKey}`) % pool.length;
    return pool[idx];
  }

  function pickRandomTarget(tier) {
    const pool = getAnswerPool(tier);
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  // Korean Search & Choseong Helpers
  function normalizeQuery(str) {
    return (str || "").toLowerCase().replace(/[\s:·\-_'".!?]/g, "");
  }

  function getChoseongChar(ch) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      return CHOSEONG[Math.floor((code - 0xac00) / 588)];
    }
    return ch;
  }

  function matchesKoreanQuery(rawText, normQuery) {
    const normText = normalizeQuery(rawText);
    if (!normText) return false;
    if (normText.includes(normQuery)) return true;

    const hasJamo = /[ㄱ-ㅎ]/.test(normQuery);
    if (!hasJamo) return false;

    const qLen = normQuery.length;
    if (qLen > normText.length) return false;

    for (let i = 0; i <= normText.length - qLen; i++) {
      let ok = true;
      for (let j = 0; j < qLen; j++) {
        const qCh = normQuery[j];
        const tCh = normText[i + j];
        if (qCh === tCh) continue;
        if (/[ㄱ-ㅎ]/.test(qCh) && getChoseongChar(tCh) === qCh) continue;
        ok = false;
        break;
      }
      if (ok) return true;
    }
    return false;
  }

  function isRevealableChar(ch) {
    return /[\uac00-\ud7a3a-zA-Z0-9]/.test(ch);
  }

  function getChoseongChars(str) {
    const chars = [];
    for (const ch of str) {
      if (!isRevealableChar(ch)) continue;
      chars.push(getChoseongChar(ch));
    }
    return chars;
  }

  function formatPartialChoseong(str, revealCount) {
    return getChoseongChars(str).slice(0, revealCount).join(" ");
  }

  function getAllowedHints() {
    return Math.min(3, Math.max(0, state.guesses.length - 1));
  }

  function getHintCount() {
    const h = state.hints;
    return (
      (h.choseongCount || 0) +
      (h.designer ? 1 : 0) +
      (h.art ? 1 : 0) +
      Object.keys(h.attrs || {}).length
    );
  }

  // Persistence: Daily Stats (with skip-day streak break)
  function loadDailyStats() {
    const fallback = {
      played: 0,
      wins: 0,
      noHintWins: 0,
      totalHintsOnWins: 0,
      streak: 0,
      maxStreak: 0,
      dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      lastDailyDate: "",
    };
    try {
      const raw = localStorage.getItem("boardle_stats_v1");
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  }

  function saveDailyStats(stats) {
    try {
      localStorage.setItem("boardle_stats_v1", JSON.stringify(stats));
    } catch {
      // ignore
    }
  }

  function getEffectiveDailyStreak(stats) {
    const today = getTodayKey();
    const yesterday = getPrevDateKey(today);
    if (stats.lastDailyDate === today || stats.lastDailyDate === yesterday) {
      return stats.streak || 0;
    }
    return 0;
  }

  function recordDailyResult(dateKey, won, attempts, hintCount = 0) {
    const today = getTodayKey();
    if (dateKey !== today) return; // Archive plays don't alter today's daily streak/stats
    const stats = loadDailyStats();
    if (stats.lastDailyDate === today) return;

    const yesterday = getPrevDateKey(today);
    stats.played += 1;
    if (won) {
      stats.wins += 1;
      if (hintCount === 0) stats.noHintWins += 1;
      stats.totalHintsOnWins += hintCount;
      stats.streak = stats.lastDailyDate === yesterday ? stats.streak + 1 : 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.dist[attempts] = (stats.dist[attempts] || 0) + 1;
    } else {
      stats.streak = 0;
    }
    stats.lastDailyDate = today;
    saveDailyStats(stats);
  }

  // Persistence: Daily Archive States (per dateKey)
  function loadDailyArchiveMap() {
    try {
      const raw = localStorage.getItem("boardle_daily_archive_v1");
      const map = raw ? JSON.parse(raw) : {};
      // Migrate legacy boardle_daily_v2 if present
      const legacyRaw = localStorage.getItem("boardle_daily_v2");
      if (legacyRaw) {
        const leg = JSON.parse(legacyRaw);
        if (leg.date && !map[leg.date]) {
          map[leg.date] = leg;
          localStorage.setItem("boardle_daily_archive_v1", JSON.stringify(map));
        }
      }
      return map;
    } catch {
      return {};
    }
  }

  function saveDailyArchiveEntry() {
    if (state.mode !== "daily" || !state.dailyDateKey) return;
    try {
      const map = loadDailyArchiveMap();
      map[state.dailyDateKey] = {
        date: state.dailyDateKey,
        targetId: state.target?.id,
        guessIds: state.guesses.map((g) => g.id),
        status: state.status,
        continueAfterLoss: state.continueAfterLoss,
        revealedAnswer: state.revealedAnswer,
        hints: state.hints,
      };
      localStorage.setItem("boardle_daily_archive_v1", JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  // Persistence: Endless Mode per-tier state & stats
  function loadEndlessStateMap() {
    try {
      const raw = localStorage.getItem("boardle_endless_state_v1");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveEndlessState() {
    if (state.mode !== "endless") return;
    try {
      const map = loadEndlessStateMap();
      map[state.endlessPool] = {
        targetId: state.target?.id,
        guessIds: state.guesses.map((g) => g.id),
        status: state.status,
        continueAfterLoss: state.continueAfterLoss,
        revealedAnswer: state.revealedAnswer,
        hints: state.hints,
      };
      localStorage.setItem("boardle_endless_state_v1", JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  function loadEndlessStats() {
    const emptyTier = () => ({ played: 0, wins: 0, streak: 0, maxStreak: 0, noHintWins: 0 });
    const fallback = { easy: emptyTier(), normal: emptyTier(), hard: emptyTier() };
    try {
      const raw = localStorage.getItem("boardle_endless_stats_v1");
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        easy: { ...emptyTier(), ...(parsed.easy || {}) },
        normal: { ...emptyTier(), ...(parsed.normal || {}) },
        hard: { ...emptyTier(), ...(parsed.hard || {}) },
      };
    } catch {
      return fallback;
    }
  }

  function recordEndlessResult(tier, won, hintCount = 0) {
    const stats = loadEndlessStats();
    const t = stats[tier] || stats.normal;
    t.played += 1;
    if (won) {
      t.wins += 1;
      if (hintCount === 0) t.noHintWins += 1;
      t.streak += 1;
      t.maxStreak = Math.max(t.maxStreak, t.streak);
    } else {
      t.streak = 0;
    }
    try {
      localStorage.setItem("boardle_endless_stats_v1", JSON.stringify(stats));
    } catch {
      // ignore
    }
  }

  function persistCurrentState() {
    if (state.mode === "daily") saveDailyArchiveEntry();
    else saveEndlessState();
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      el.toast.classList.add("hidden");
    }, 2200);
  }

  // Comparison Logic
  function compareNumber(val, targetVal, exactTol, closeTol) {
    const abs = Math.abs(val - targetVal);
    let status = "gray";
    if (abs <= exactTol) status = "green";
    else if (abs <= closeTol) status = "yellow";

    let dir = "";
    if (abs > exactTol) {
      if (targetVal > val) dir = "▲";
      else if (targetVal < val) dir = "▼";
    }
    return { status, dir };
  }

  function comparePlaytime(guess, target) {
    const gMid = (guess.minT + guess.maxT) / 2;
    const tMid = (target.minT + target.maxT) / 2;
    const sameRange = guess.minT === target.minT && guess.maxT === target.maxT;
    const midDiff = Math.abs(gMid - tMid);
    const overlaps = guess.minT <= target.maxT && target.minT <= guess.maxT;

    let status = "gray";
    if (sameRange || midDiff <= 10) status = "green";
    else if (overlaps || midDiff <= 30) status = "yellow";

    let dir = "";
    if (status !== "green") {
      if (tMid > gMid) dir = "▲";
      else if (tMid < gMid) dir = "▼";
    }
    return { status, dir };
  }

  function compareTags(guessTags, targetTags) {
    const targetSet = new Set(targetTags);
    const matched = guessTags.filter((t) => targetSet.has(t));
    const allMatched = targetTags.length > 0 && matched.length === targetTags.length;

    let status = "gray";
    if (matched.length >= 2 || allMatched) status = "green";
    else if (matched.length === 1) status = "yellow";

    return { status, matchedSet: new Set(matched) };
  }

  function evaluateGuess(guess, target) {
    return {
      year: compareNumber(guess.year, target.year, 0, 3),
      diff: compareNumber(guess.diff, target.diff, 0.15, 0.5),
      minP: compareNumber(guess.minP, target.minP, 0, 1),
      maxP: compareNumber(guess.maxP, target.maxP, 0, 1),
      time: comparePlaytime(guess, target),
      mech: compareTags(guess.mech, target.mech),
      theme: compareTags(guess.theme, target.theme),
    };
  }

  // Rendering
  function createThumbHtml(game, cls = "game-thumb") {
    if (game.thumb) {
      return `<img class="${cls}" src="${game.thumb}" alt="" loading="lazy" draggable="false" />`;
    }
    return `<div class="${cls} ac-thumb-placeholder">🎲</div>`;
  }

  function renderGrid() {
    el.guessTbody.innerHTML = "";
    el.emptyState.classList.toggle("hidden", state.guesses.length > 0);

    const reversed = [...state.guesses].reverse();
    for (const guess of reversed) {
      const ev = evaluateGuess(guess, state.target);
      const tr = document.createElement("tr");
      tr.className = "guess-row";

      const mechHtml = guess.mech.length
        ? guess.mech
            .map((t) => `<span class="tag-chip ${ev.mech.matchedSet.has(t) ? "matched" : ""}">${t}</span>`)
            .join("")
        : `<span class="tag-chip">-</span>`;

      const themeHtml = guess.theme.length
        ? guess.theme
            .map((t) => `<span class="tag-chip ${ev.theme.matchedSet.has(t) ? "matched" : ""}">${t}</span>`)
            .join("")
        : `<span class="tag-chip">-</span>`;

      tr.innerHTML = `
        <td class="cell cell-game">
          <div class="game-cell-inner">
            ${createThumbHtml(guess)}
            <div>
              <div class="game-name-kr">${guess.kr}</div>
              ${guess.en ? `<div class="game-name-en">${guess.en}</div>` : ""}
            </div>
          </div>
        </td>
        <td class="cell ${ev.year.status}" data-label="출시 연도">
          <div class="mobile-attr-label">출시 연도</div>
          <span class="num-val">${guess.year}</span>
          ${ev.year.dir ? `<span class="num-dir">${ev.year.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.diff.status}" data-label="난이도">
          <div class="mobile-attr-label">난이도</div>
          <span class="num-val">${guess.diff.toFixed(2)}</span>
          ${ev.diff.dir ? `<span class="num-dir">${ev.diff.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.minP.status}" data-label="최소 인원">
          <div class="mobile-attr-label">최소 인원</div>
          <span class="num-val">${guess.minP}명</span>
          ${ev.minP.dir ? `<span class="num-dir">${ev.minP.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.maxP.status}" data-label="최대 인원">
          <div class="mobile-attr-label">최대 인원</div>
          <span class="num-val">${guess.maxP}명</span>
          ${ev.maxP.dir ? `<span class="num-dir">${ev.maxP.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.time.status}" data-label="플레이 타임">
          <div class="mobile-attr-label">플레이 타임</div>
          <span class="num-val">${guess.timeStr}</span>
          ${ev.time.dir ? `<span class="num-dir">${ev.time.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.mech.status}" data-label="메커니즘">
          <div class="mobile-attr-label">메커니즘</div>
          <div class="tag-list">${mechHtml}</div>
        </td>
        <td class="cell ${ev.theme.status}" data-label="테마">
          <div class="mobile-attr-label">테마</div>
          <div class="tag-list">${themeHtml}</div>
        </td>
      `;
      el.guessTbody.appendChild(tr);
    }
  }

  function renderClueBoard() {
    if (state.guesses.length === 0) {
      el.clueBoard.classList.add("hidden");
      return;
    }

    const foundMech = new Set();
    const foundTheme = new Set();
    const targetMech = new Set(state.target.mech);
    const targetTheme = new Set(state.target.theme);

    for (const g of state.guesses) {
      for (const m of g.mech) {
        if (targetMech.has(m)) foundMech.add(m);
      }
      for (const t of g.theme) {
        if (targetTheme.has(t)) foundTheme.add(t);
      }
    }

    el.clueBoard.classList.remove("hidden");
    el.clueMechList.innerHTML = foundMech.size
      ? [...foundMech].map((m) => `<span class="tag-chip matched">${m}</span>`).join("")
      : `<span class="clue-empty">아직 없음</span>`;
    el.clueThemeList.innerHTML = foundTheme.size
      ? [...foundTheme].map((t) => `<span class="tag-chip matched">${t}</span>`).join("")
      : `<span class="clue-empty">아직 없음</span>`;
  }

  function isInputActive() {
    return (
      state.status === "playing" ||
      (state.status === "lost" && state.continueAfterLoss && !state.revealedAnswer)
    );
  }

  function isPostLossPractice() {
    return state.status === "lost" && state.continueAfterLoss && !state.revealedAnswer;
  }

  function canSpendHint() {
    if (!isInputActive()) return false;
    if (isPostLossPractice()) return true;
    return getHintCount() < getAllowedHints();
  }

  function renderHints() {
    const h = state.hints;
    const totalHints = getHintCount();
    const allowedHints = getAllowedHints();
    const maxChars = getChoseongChars(state.target.kr).length;
    const canSpend = canSpendHint();

    if (isPostLossPractice()) {
      el.hintCounter.textContent = `힌트: ${totalHints}개 사용 (무제한)`;
    } else if (state.guesses.length < 2 && isInputActive()) {
      el.hintCounter.textContent = "힌트: 2회 시도 후 해금";
    } else {
      el.hintCounter.textContent = `힌트: ${totalHints} / ${allowedHints}개 사용`;
    }

    el.btnHintChoseong.disabled = !canSpend || h.choseongCount >= maxChars;
    el.btnHintChoseong.textContent = "🔤 초성 1글자";
    el.btnHintChoseong.classList.toggle("used", h.choseongCount > 0);

    el.btnHintDesigner.disabled = !canSpend || h.designer || !state.target.designer;
    el.btnHintDesigner.classList.toggle("used", h.designer);

    el.btnHintArt.disabled = !canSpend || h.art || !state.target.thumb;
    el.btnHintArt.textContent = state.target.thumb ? "🖼️ 박스아트(일부·블러)" : "🖼️ 박스아트(없음)";
    el.btnHintArt.classList.toggle("used", h.art);

    el.btnHintAttrToggle.disabled = !canSpend;
    el.btnHintAttrToggle.classList.toggle("used", Object.keys(h.attrs).length > 0);

    el.attrPicker.classList.toggle("hidden", !state.attrPickerOpen || !canSpend);
    el.attrPickerList.innerHTML = ATTR_DEFS.map((attr) => {
      const revealed = Boolean(h.attrs[attr.key]);
      return `
        <button
          type="button"
          class="attr-pill ${revealed ? "revealed" : ""}"
          data-attr-key="${attr.key}"
          ${revealed || !canSpend ? "disabled" : ""}
        >
          ${attr.label}${revealed ? " ✓" : ""}
        </button>
      `;
    }).join("");

    el.attrPickerList.querySelectorAll("[data-attr-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.attrKey;
        if (!state.hints.attrs[key] && canSpendHint()) {
          state.hints.attrs[key] = true;
          state.attrPickerOpen = false;
          persistCurrentState();
          renderHints();
        }
      });
    });

    const items = [];
    if (h.choseongCount > 0) {
      items.push(`
        <div class="hint-item">
          <div>
            <strong>🔤 초성 힌트:</strong>
            <div class="hint-choseong-text">${formatPartialChoseong(state.target.kr, h.choseongCount)}</div>
          </div>
        </div>
      `);
    }
    if (h.designer) {
      items.push(`
        <div class="hint-item">
          <div><strong>👤 디자이너:</strong> ${state.target.designer || "정보 없음"}</div>
        </div>
      `);
    }
    if (h.art && state.target.thumb) {
      items.push(`
        <div class="hint-item">
          <div class="hint-crop-wrap" oncontextmenu="return false;" ondragstart="return false;">
            <img class="hint-crop-img" src="${state.target.thumb}" alt="박스아트 일부" draggable="false" />
          </div>
          <div><strong>🖼️ 박스아트 일부:</strong> 이미지의 정중앙 1/25 영역입니다 (약한 블러 적용).</div>
        </div>
      `);
    }
    for (const attr of ATTR_DEFS) {
      if (h.attrs[attr.key]) {
        items.push(`
          <div class="hint-item">
            <div><strong>🎯 ${attr.label}:</strong> ${attr.format(state.target)}</div>
          </div>
        `);
      }
    }

    if (items.length > 0) {
      el.hintDisplay.innerHTML = items.join("");
      el.hintDisplay.classList.remove("hidden");
    } else {
      el.hintDisplay.classList.add("hidden");
      el.hintDisplay.innerHTML = "";
    }
  }

  function renderHeaderBadges() {
    const activeDate = state.dailyDateKey || getTodayKey();
    const issueNum = getIssueNumber(activeDate);
    if (state.mode === "daily") {
      const isToday = activeDate === getTodayKey();
      el.btnDaily.textContent = isToday ? `오늘의 게임 #${issueNum}` : `오늘의 게임 #${issueNum} (지난)`;
      el.endlessStreakBadge.classList.add("hidden");
    } else {
      const todayNum = getIssueNumber(getTodayKey());
      el.btnDaily.textContent = `오늘의 게임 #${todayNum}`;
      const eStats = loadEndlessStats()[state.endlessPool];
      el.endlessStreakBadge.textContent = `🔥 연승: ${eStats.streak} (최고 ${eStats.maxStreak})`;
      el.endlessStreakBadge.classList.remove("hidden");
    }
  }

  function renderStatusAndBanner() {
    const count = state.guesses.length;
    const hintCount = getHintCount();

    if (state.status === "lost" && state.continueAfterLoss) {
      el.attemptCounter.textContent = `패배 후 계속 풀기 (${count}회 시도 중)`;
      el.attemptCounter.classList.add("practice");
    } else {
      el.attemptCounter.textContent = `시도: ${Math.min(count, MAX_ATTEMPTS)} / ${MAX_ATTEMPTS}`;
      el.attemptCounter.classList.remove("practice");
    }

    el.searchInput.disabled = !isInputActive();

    if (state.status === "playing") {
      el.resultBanner.classList.add("hidden");
      return;
    }

    const solvedInPractice =
      state.status === "lost" &&
      state.guesses.some((g) => g.id === state.target.id);

    if (state.status === "won" || solvedInPractice || state.revealedAnswer) {
      const isWin = state.status === "won";
      el.resultBanner.className = `result-banner ${isWin ? "win" : "loss"}`;
      const heading = isWin
        ? `🎉 정답입니다! (${count}번 만에 맞힘 · 힌트 ${hintCount}개 사용)`
        : solvedInPractice
          ? `🧩 ${count}번의 시도 끝에 정답을 찾았습니다! (패배 후 연습 · 힌트 ${hintCount}개)`
          : `😢 아쉽네요! 5번 안에 맞히지 못했습니다. (힌트 ${hintCount}개 사용)`;

      el.resultBanner.innerHTML = `
        <div class="result-info">
          ${createThumbHtml(state.target, "result-thumb")}
          <div>
            <div class="result-title">${heading}</div>
            <div class="result-sub">정답: <strong>${state.target.kr}</strong> (${state.target.en ? `${state.target.en}, ` : ""}${state.target.year})</div>
          </div>
        </div>
        <div class="result-actions">
          <button id="btn-share" class="btn-primary" type="button">📋 결과 공유</button>
          ${state.target.url ? `<a class="btn-secondary" href="${state.target.url}" target="_blank" rel="noopener">보드라이프 보기</a>` : ""}
          ${state.mode === "endless" ? `<button id="btn-banner-new" class="btn-primary" type="button">🔄 다음 문제</button>` : ""}
        </div>
      `;

      const btnShare = document.getElementById("btn-share");
      if (btnShare) btnShare.addEventListener("click", shareResult);
      const btnBannerNew = document.getElementById("btn-banner-new");
      if (btnBannerNew) btnBannerNew.addEventListener("click", () => startEndlessGame(true));
      el.resultBanner.classList.remove("hidden");
      return;
    }

    el.resultBanner.className = "result-banner loss";
    el.resultBanner.innerHTML = `
      <div class="result-info">
        <div>
          <div class="result-title">😢 5번의 시도를 모두 사용했습니다 (패배 · 힌트 ${hintCount}개)</div>
          <div class="result-sub">힌트를 무제한으로 활용하며 끝까지 풀어보거나, 정답을 바로 확인할 수 있습니다.</div>
        </div>
      </div>
      <div class="result-actions">
        ${!state.continueAfterLoss ? `<button id="btn-continue-practice" class="btn-primary" type="button">💡 계속 풀기</button>` : ""}
        <button id="btn-reveal-answer" class="btn-secondary" type="button">👀 정답 보기</button>
        <button id="btn-share" class="btn-secondary" type="button">📋 결과 공유</button>
      </div>
    `;

    const btnCont = document.getElementById("btn-continue-practice");
    if (btnCont) {
      btnCont.addEventListener("click", () => {
        state.continueAfterLoss = true;
        persistCurrentState();
        renderAll();
        el.searchInput.focus();
      });
    }
    const btnRev = document.getElementById("btn-reveal-answer");
    if (btnRev) {
      btnRev.addEventListener("click", () => {
        state.revealedAnswer = true;
        state.attrPickerOpen = false;
        persistCurrentState();
        renderAll();
      });
    }
    const btnShare = document.getElementById("btn-share");
    if (btnShare) btnShare.addEventListener("click", shareResult);

    el.resultBanner.classList.remove("hidden");
  }

  function renderAll() {
    renderHeaderBadges();
    renderGrid();
    renderClueBoard();
    renderHints();
    renderStatusAndBanner();
  }

  function shareResult() {
    const firstFive = state.guesses.slice(0, MAX_ATTEMPTS);
    const score = state.status === "won" ? `${firstFive.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
    const hintCount = getHintCount();
    const emojiMap = { green: "🟩", yellow: "🟨", gray: "⬜" };
    const rows = firstFive.map((g) => {
      const ev = evaluateGuess(g, state.target);
      return [
        emojiMap[ev.year.status],
        emojiMap[ev.diff.status],
        emojiMap[ev.minP.status],
        emojiMap[ev.maxP.status],
        emojiMap[ev.time.status],
        emojiMap[ev.mech.status],
        emojiMap[ev.theme.status],
      ].join("");
    });

    const tierShort = { easy: "쉬움", normal: "보통", hard: "어려움" };
    let headerText = "";
    if (state.mode === "daily") {
      const issueNum = getIssueNumber(state.dailyDateKey);
      headerText = `🎲 BOARDLE 오늘의 게임 #${issueNum} (${state.dailyDateKey}) · ${score} · 💡힌트 ${hintCount}`;
    } else {
      headerText = `🎲 BOARDLE 무한 모드(${tierShort[state.endlessPool] || "보통"}) · ${score} · 💡힌트 ${hintCount}`;
    }

    const text = `${headerText}\n${rows.join("\n")}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast("결과가 클립보드에 복사되었습니다!"),
        () => showToast("복사에 실패했습니다.")
      );
    } else {
      showToast(text);
    }
  }

  // Submitting a guess
  function submitGuess(game) {
    if (!game) return;
    if (state.guesses.some((g) => g.id === game.id)) {
      showToast("이미 입력한 게임입니다.");
      return;
    }

    state.guesses.push(game);
    el.searchInput.value = "";
    hideAutocomplete();

    const isCorrect = game.id === state.target.id;

    if (state.status === "playing") {
      if (isCorrect) {
        state.status = "won";
        state.attrPickerOpen = false;
        const hc = getHintCount();
        if (state.mode === "daily") {
          recordDailyResult(state.dailyDateKey, true, state.guesses.length, hc);
        } else {
          recordEndlessResult(state.endlessPool, true, hc);
        }
        logPlayToSupabase({
          dateKey: state.mode === "daily" ? state.dailyDateKey : getTodayKey(),
          mode: state.mode === "daily" ? "daily" : `endless_${state.endlessPool}`,
          won: true,
          attempts: state.guesses.length,
          hints: hc,
        });
      } else if (state.guesses.length >= MAX_ATTEMPTS) {
        state.status = "lost";
        state.attrPickerOpen = false;
        const hc = getHintCount();
        if (state.mode === "daily") {
          recordDailyResult(state.dailyDateKey, false, MAX_ATTEMPTS, hc);
        } else {
          recordEndlessResult(state.endlessPool, false, hc);
        }
        logPlayToSupabase({
          dateKey: state.mode === "daily" ? state.dailyDateKey : getTodayKey(),
          mode: state.mode === "daily" ? "daily" : `endless_${state.endlessPool}`,
          won: false,
          attempts: MAX_ATTEMPTS,
          hints: hc,
        });
      }
    } else if (state.status === "lost" && state.continueAfterLoss && isCorrect) {
      state.revealedAnswer = true;
      state.attrPickerOpen = false;
    }

    persistCurrentState();
    renderAll();
  }

  // Autocomplete
  function hideAutocomplete() {
    el.acList.classList.add("hidden");
    el.acList.innerHTML = "";
    state.acIndex = -1;
    state.acResults = [];
  }

  function getMatchPriority(g, normQuery) {
    const krNorm = normalizeQuery(g.kr);
    const enNorm = normalizeQuery(g.en);
    const skNorm = normalizeQuery(g.sk);

    if (krNorm.startsWith(normQuery) || enNorm.startsWith(normQuery)) return 0;
    if (/[ㄱ-ㅎ]/.test(normQuery)) {
      const krCho = getChoseongChars(g.kr).join("");
      if (krCho.startsWith(normQuery)) return 0;
    }
    if (matchesKoreanQuery(g.kr, normQuery) || enNorm.includes(normQuery)) return 1;
    if (skNorm && matchesKoreanQuery(skNorm, normQuery)) return 2;
    return -1;
  }

  function updateAutocomplete(query) {
    const norm = normalizeQuery(query);
    if (!norm) {
      hideAutocomplete();
      return;
    }

    const guessedIds = new Set(state.guesses.map((g) => g.id));
    const scored = [];
    for (const g of ALL_GAMES) {
      if (guessedIds.has(g.id)) continue;
      const prio = getMatchPriority(g, norm);
      if (prio >= 0) {
        const popRank = Math.min(g.blRank || 99999, g.bggRank || 99999);
        scored.push({ game: g, prio, popRank });
      }
    }

    scored.sort((a, b) => a.prio - b.prio || a.popRank - b.popRank);
    const matches = scored.slice(0, 12).map((item) => item.game);

    state.acResults = matches;
    state.acIndex = matches.length > 0 ? 0 : -1;

    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    el.acList.innerHTML = matches
      .map(
        (g, i) => `
        <li class="autocomplete-item ${i === 0 ? "active" : ""}" data-idx="${i}" role="option">
          ${createThumbHtml(g, "ac-thumb")}
          <div class="ac-titles">
            <div class="ac-kr">${g.kr}</div>
            ${g.en ? `<div class="ac-en">${g.en}</div>` : ""}
          </div>
        </li>
      `
      )
      .join("");

    el.acList.querySelectorAll(".autocomplete-item").forEach((item) => {
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const idx = Number(item.dataset.idx);
        submitGuess(state.acResults[idx]);
      });
    });

    el.acList.classList.remove("hidden");
  }

  function highlightAcItem() {
    const items = el.acList.querySelectorAll(".autocomplete-item");
    items.forEach((item, idx) => {
      item.classList.toggle("active", idx === state.acIndex);
    });
    if (items[state.acIndex]) {
      items[state.acIndex].scrollIntoView({ block: "nearest" });
    }
  }

  // Mode Switching
  function startDailyGame(dateKey = getTodayKey()) {
    state.mode = "daily";
    state.dailyDateKey = dateKey;
    el.btnDaily.classList.add("active");
    el.btnEndless.classList.remove("active");
    el.btnArchive.classList.remove("hidden");
    el.poolSelect.classList.add("hidden");
    el.btnNewGame.classList.add("hidden");

    const target = pickDailyTarget(dateKey);
    state.target = target;
    state.guesses = [];
    state.status = "playing";
    state.continueAfterLoss = false;
    state.revealedAnswer = false;
    state.attrPickerOpen = false;
    state.hints = createEmptyHints();

    const archiveMap = loadDailyArchiveMap();
    const saved = archiveMap[dateKey];
    if (saved && saved.targetId === target.id) {
      state.guesses = (saved.guessIds || []).map((id) => GAMES_BY_ID.get(id)).filter(Boolean);
      state.status = saved.status || "playing";
      state.continueAfterLoss = Boolean(saved.continueAfterLoss);
      state.revealedAnswer = Boolean(saved.revealedAnswer);
      state.hints = saved.hints || createEmptyHints();
    }

    el.searchInput.value = "";
    hideAutocomplete();
    renderAll();
  }

  function startEndlessGame(forceNew = false) {
    state.mode = "endless";
    el.btnEndless.classList.add("active");
    el.btnDaily.classList.remove("active");
    el.btnArchive.classList.add("hidden");
    el.poolSelect.classList.remove("hidden");
    el.btnNewGame.classList.remove("hidden");

    state.endlessPool = el.poolSelect.value || "normal";
    state.attrPickerOpen = false;

    const savedMap = loadEndlessStateMap();
    const saved = !forceNew ? savedMap[state.endlessPool] : null;
    if (saved && GAMES_BY_ID.has(saved.targetId)) {
      state.target = GAMES_BY_ID.get(saved.targetId);
      state.guesses = (saved.guessIds || []).map((id) => GAMES_BY_ID.get(id)).filter(Boolean);
      state.status = saved.status || "playing";
      state.continueAfterLoss = Boolean(saved.continueAfterLoss);
      state.revealedAnswer = Boolean(saved.revealedAnswer);
      state.hints = saved.hints || createEmptyHints();
    } else {
      state.target = pickRandomTarget(state.endlessPool);
      state.guesses = [];
      state.status = "playing";
      state.continueAfterLoss = false;
      state.revealedAnswer = false;
      state.hints = createEmptyHints();
      saveEndlessState();
    }

    el.searchInput.value = "";
    hideAutocomplete();
    renderAll();
  }

  // Archive Modal
  function renderArchiveModal() {
    const keys = getAllArchiveDateKeys();
    const archiveMap = loadDailyArchiveMap();
    const today = getTodayKey();

    el.archiveList.innerHTML = keys
      .map((dk) => {
        const num = getIssueNumber(dk);
        const saved = archiveMap[dk];
        let badge = `<span class="archive-status" style="color:var(--muted);">⬜ 미도전</span>`;
        if (saved?.status === "won") {
          badge = `<span class="archive-status" style="color:var(--green-bright);">🟩 성공 (${(saved.guessIds || []).length}/${MAX_ATTEMPTS})</span>`;
        } else if (saved?.status === "lost") {
          badge = `<span class="archive-status" style="color:var(--red);">🟥 실패</span>`;
        } else if (saved && (saved.guessIds || []).length > 0) {
          badge = `<span class="archive-status" style="color:var(--yellow-bright);">🟨 진행 중</span>`;
        }
        const isCurrent = state.mode === "daily" && state.dailyDateKey === dk;
        const todayTag = dk === today ? " (오늘)" : "";
        return `
          <button type="button" class="archive-item ${isCurrent ? "current" : ""}" data-date-key="${dk}">
            <span>#${num} · ${dk}${todayTag}</span>
            ${badge}
          </button>
        `;
      })
      .join("");

    el.archiveList.querySelectorAll("[data-date-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        el.modalArchive.classList.add("hidden");
        startDailyGame(btn.dataset.dateKey);
      });
    });
  }

  // Stats Modal
  async function renderStatsModal() {
    el.tabStatsDaily.classList.toggle("active", state.statsTab === "daily");
    el.tabStatsEndless.classList.toggle("active", state.statsTab === "endless");
    el.tabStatsGlobal.classList.toggle("active", state.statsTab === "global");

    if (state.statsTab === "daily") {
      const s = loadDailyStats();
      const winRate = s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0;
      const avgHints = s.wins > 0 ? (s.totalHintsOnWins / s.wins).toFixed(1) : "0.0";
      const curStreak = getEffectiveDailyStreak(s);
      const maxDist = Math.max(1, ...Object.values(s.dist));

      const distHtml = [1, 2, 3, 4, 5]
        .map((n) => {
          const cnt = s.dist[n] || 0;
          const pct = Math.max(8, Math.round((cnt / maxDist) * 100));
          return `
            <div class="dist-row">
              <span>${n}회</span>
              <div class="dist-bar-wrap">
                <div class="dist-bar" style="width:${cnt > 0 ? pct : 0}%">${cnt}</div>
              </div>
            </div>
          `;
        })
        .join("");

      el.statsBody.innerHTML = `
        <div class="stats-grid">
          <div class="stat-box"><div class="stat-num">${s.played}</div><div class="stat-lbl">플레이</div></div>
          <div class="stat-box"><div class="stat-num">${winRate}%</div><div class="stat-lbl">승률</div></div>
          <div class="stat-box"><div class="stat-num">${curStreak}</div><div class="stat-lbl">현재 연승</div></div>
          <div class="stat-box"><div class="stat-num">${s.maxStreak}</div><div class="stat-lbl">최대 연승</div></div>
        </div>
        <div class="stats-grid stats-grid-sub">
          <div class="stat-box"><div class="stat-num">${s.noHintWins || 0}</div><div class="stat-lbl">노힌트 클리어</div></div>
          <div class="stat-box"><div class="stat-num">${avgHints}</div><div class="stat-lbl">평균 힌트 (승리 시)</div></div>
        </div>
        <p style="font-weight:700; margin-bottom:8px;">시도 횟수 분포 (5회 이내)</p>
        ${distHtml}
      `;
      return;
    }

    if (state.statsTab === "endless") {
      const es = loadEndlessStats();
      el.statsBody.innerHTML = ["easy", "normal", "hard"]
        .map((tier) => {
          const t = es[tier];
          const rate = t.played > 0 ? Math.round((t.wins / t.played) * 100) : 0;
          return `
            <div class="endless-tier-card">
              <div class="endless-tier-title">${TIER_LABELS[tier]}</div>
              <div class="endless-tier-row">
                <span>플레이 ${t.played}판 · 승률 ${rate}%</span>
                <span>🔥 연승 ${t.streak} / 최고 ${t.maxStreak}</span>
              </div>
            </div>
          `;
        })
        .join("");
      return;
    }

    // Global Stats (Supabase)
    el.statsBody.innerHTML = `<p style="text-align:center; color:var(--muted); padding:20px 0;">전체 통계를 불러오는 중...</p>`;
    const gs = await fetchGlobalStats();
    if (!gs.configured) {
      el.statsBody.innerHTML = `<p style="text-align:center; color:var(--muted); padding:20px 0;">전체 통계 서버가 아직 연결되지 않았습니다.</p>`;
      return;
    }
    if (gs.error) {
      el.statsBody.innerHTML = `<p style="text-align:center; color:var(--muted); padding:20px 0;">통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>`;
      return;
    }

    el.statsBody.innerHTML = `
      <div class="stats-grid">
        <div class="stat-box"><div class="stat-num">${gs.uniquePlayers}</div><div class="stat-lbl">총 플레이어</div></div>
        <div class="stat-box"><div class="stat-num">${gs.totalPlays}</div><div class="stat-lbl">총 플레이 판수</div></div>
        <div class="stat-box"><div class="stat-num">${gs.winRate}%</div><div class="stat-lbl">전체 정답률</div></div>
        <div class="stat-box"><div class="stat-num">${gs.avgHints}</div><div class="stat-lbl">평균 힌트</div></div>
      </div>
      <div class="stats-grid stats-grid-sub">
        <div class="stat-box"><div class="stat-num">${gs.todayPlays}</div><div class="stat-lbl">오늘의 게임 도전</div></div>
        <div class="stat-box"><div class="stat-num">${gs.todayRate}%</div><div class="stat-lbl">오늘의 게임 정답률</div></div>
      </div>
    `;
  }

  // Event Listeners
  function bindEvents() {
    el.btnDaily.addEventListener("click", () => startDailyGame(getTodayKey()));
    el.btnEndless.addEventListener("click", () => startEndlessGame(false));
    el.poolSelect.addEventListener("change", () => startEndlessGame(false));
    el.btnNewGame.addEventListener("click", () => startEndlessGame(true));

    el.btnArchive.addEventListener("click", () => {
      renderArchiveModal();
      el.modalArchive.classList.remove("hidden");
    });

    el.btnCriteriaHelp.addEventListener("click", () => {
      const open = el.criteriaPanel.classList.toggle("hidden");
      el.btnCriteriaHelp.classList.toggle("active", !open);
    });

    el.searchInput.addEventListener("input", (e) => {
      updateAutocomplete(e.target.value);
    });

    el.searchInput.addEventListener("keydown", (e) => {
      if (el.acList.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.acIndex = (state.acIndex + 1) % state.acResults.length;
        highlightAcItem();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.acIndex = (state.acIndex - 1 + state.acResults.length) % state.acResults.length;
        highlightAcItem();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (state.acIndex >= 0 && state.acResults[state.acIndex]) {
          submitGuess(state.acResults[state.acIndex]);
        }
      } else if (e.key === "Escape") {
        hideAutocomplete();
      }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-box-wrap")) {
        hideAutocomplete();
      }
    });

    el.btnHintChoseong.addEventListener("click", () => {
      const maxChars = getChoseongChars(state.target.kr).length;
      if (canSpendHint() && state.hints.choseongCount < maxChars) {
        state.hints.choseongCount += 1;
        persistCurrentState();
        renderHints();
      }
    });

    el.btnHintDesigner.addEventListener("click", () => {
      if (canSpendHint() && !state.hints.designer) {
        state.hints.designer = true;
        persistCurrentState();
        renderHints();
      }
    });

    el.btnHintArt.addEventListener("click", () => {
      if (canSpendHint() && !state.hints.art && state.target.thumb) {
        state.hints.art = true;
        persistCurrentState();
        renderHints();
      }
    });

    el.btnHintAttrToggle.addEventListener("click", () => {
      if (!canSpendHint()) return;
      state.attrPickerOpen = !state.attrPickerOpen;
      renderHints();
    });

    el.btnHelp.addEventListener("click", () => el.modalHelp.classList.remove("hidden"));
    el.btnStats.addEventListener("click", () => {
      renderStatsModal();
      el.modalStats.classList.remove("hidden");
    });

    el.tabStatsDaily.addEventListener("click", () => {
      state.statsTab = "daily";
      renderStatsModal();
    });
    el.tabStatsEndless.addEventListener("click", () => {
      state.statsTab = "endless";
      renderStatsModal();
    });
    el.tabStatsGlobal.addEventListener("click", () => {
      state.statsTab = "global";
      renderStatsModal();
    });

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(btn.dataset.close).classList.add("hidden");
      });
    });

    [el.modalHelp, el.modalStats, el.modalArchive].forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
      });
    });
  }

  function init() {
    if (ALL_GAMES.length === 0) {
      el.emptyState.textContent = "게임 데이터를 불러오지 못했습니다. build_game_data.py를 실행해 주세요.";
      return;
    }
    bindEvents();
    startDailyGame(getTodayKey());
  }

  init();
})();
