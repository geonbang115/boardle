(() => {
  const MAX_ATTEMPTS = 5;
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

  const ATTR_HELP_MAP = {
    year: {
      title: "출시 연도",
      body: "🟩 정확히 일치<br>🟨 ±3년 이내<br>⬜ 4년 이상 차이<br>▲ 더 최신 / ▼ 더 과거",
    },
    diff: {
      title: "난이도 (웨이트)",
      body: "🟩 ±0.15 이내<br>🟨 ±0.50 이내<br>⬜ 0.50 초과 차이<br>▲ 더 어려움 / ▼ 더 쉬움",
    },
    minP: {
      title: "최소 인원",
      body: "🟩 정확히 일치<br>🟨 ±1명 차이<br>⬜ 2명 이상 차이<br>▲ 더 많음 / ▼ 더 적음",
    },
    maxP: {
      title: "최대 인원",
      body: "🟩 정확히 일치<br>🟨 ±1명 차이<br>⬜ 2명 이상 차이<br>▲ 더 많음 / ▼ 더 적음",
    },
    time: {
      title: "플레이 타임",
      body: "🟩 범위 동일 또는 중간값 ±10분 이내<br>🟨 시간 구간 겹침 또는 중간값 ±30분 이내<br>▲ 더 김 / ▼ 더 짧음",
    },
    mech: {
      title: "메커니즘",
      body: "🟩 2개 이상 일치 (또는 전부 일치)<br>🟨 1개 일치 (일치 태그 초록 강조)<br>⬜ 겹치는 메커니즘 없음",
    },
    theme: {
      title: "테마",
      body: "🟩 2개 이상 일치 (또는 전부 일치)<br>🟨 1개 일치 (일치 태그 초록 강조)<br>⬜ 겹치는 테마 없음",
    },
  };

  const ALL_GAMES = Array.isArray(window.BGG_GAMES) ? window.BGG_GAMES : [];

  const createEmptyHints = () => ({
    choseongCount: 0,
    designer: false,
    art: false,
    attrs: {},
  });

  const state = {
    mode: "daily", // "daily" | "endless"
    endlessPool: "normal",
    target: null,
    guesses: [],
    status: "playing", // "playing" | "won" | "lost"
    continueAfterLoss: false,
    revealedAnswer: false,
    attrPickerOpen: false,
    hints: createEmptyHints(),
    acIndex: -1,
    acResults: [],
  };

  // DOM Elements
  const el = {
    btnDaily: document.getElementById("btn-mode-daily"),
    btnEndless: document.getElementById("btn-mode-endless"),
    poolSelect: document.getElementById("pool-select"),
    btnNewGame: document.getElementById("btn-new-game"),
    btnHelp: document.getElementById("btn-help"),
    btnStats: document.getElementById("btn-stats"),
    searchInput: document.getElementById("search-input"),
    acList: document.getElementById("autocomplete-list"),
    attemptCounter: document.getElementById("attempt-counter"),
    hintCounter: document.getElementById("hint-counter"),
    hintControls: document.getElementById("hint-controls"),
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
    guessTbody: document.getElementById("guess-tbody"),
    emptyState: document.getElementById("empty-state"),
    modalHelp: document.getElementById("modal-help"),
    modalStats: document.getElementById("modal-stats"),
    statsBody: document.getElementById("stats-body"),
    attrPopover: document.getElementById("attr-tooltip-popover"),
    toast: document.getElementById("toast"),
  };

  function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

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
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const idx = Math.floor((code - 0xac00) / 588);
        chars.push(CHOSEONG[idx]);
      } else {
        chars.push(ch);
      }
    }
    return chars;
  }

  function formatPartialChoseong(str, revealCount) {
    return getChoseongChars(str).slice(0, revealCount).join(" ");
  }

  function getAllowedHints() {
    return Math.max(0, state.guesses.length - 2);
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

  function loadStats() {
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

  function saveStats(stats) {
    try {
      localStorage.setItem("boardle_stats_v1", JSON.stringify(stats));
    } catch {
      // ignore storage errors
    }
  }

  function recordDailyResult(won, attempts, hintCount = 0) {
    const today = getTodayKey();
    const stats = loadStats();
    if (stats.lastDailyDate === today) return;
    stats.played += 1;
    stats.lastDailyDate = today;
    if (won) {
      stats.wins += 1;
      if (hintCount === 0) stats.noHintWins += 1;
      stats.totalHintsOnWins += hintCount;
      stats.streak += 1;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      stats.dist[attempts] = (stats.dist[attempts] || 0) + 1;
    } else {
      stats.streak = 0;
    }
    saveStats(stats);
  }

  function saveDailyState() {
    if (state.mode !== "daily") return;
    const payload = {
      date: getTodayKey(),
      targetId: state.target?.id,
      guessIds: state.guesses.map((g) => g.id),
      status: state.status,
      continueAfterLoss: state.continueAfterLoss,
      revealedAnswer: state.revealedAnswer,
      hints: state.hints,
    };
    try {
      localStorage.setItem("boardle_daily_v2", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function loadDailyState() {
    try {
      const raw = localStorage.getItem("boardle_daily_v2");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.date !== getTodayKey()) return null;
      return parsed;
    } catch {
      return null;
    }
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
    const diff = val - targetVal;
    const abs = Math.abs(diff);
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
    if (sameRange || midDiff <= 10) {
      status = "green";
    } else if (overlaps || midDiff <= 30) {
      status = "yellow";
    }

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
      return `<img class="${cls}" src="${game.thumb}" alt="" loading="lazy" />`;
    }
    return `<div class="${cls} ac-thumb-placeholder">🎲</div>`;
  }

  const HELP_ATTRS = new Set(["diff", "time", "mech", "theme"]);

  function mobileLabel(key, label) {
    const helpBtn = HELP_ATTRS.has(key)
      ? `<button type="button" class="attr-help-btn" data-help-attr="${key}" aria-label="${label} 기준">?</button>`
      : "";
    return `<div class="mobile-attr-label">${label}${helpBtn}</div>`;
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
              <div class="game-name-en">${guess.en}</div>
            </div>
          </div>
        </td>
        <td class="cell ${ev.year.status}" data-label="출시 연도">
          ${mobileLabel("year", "출시 연도")}
          <span class="num-val">${guess.year}</span>
          ${ev.year.dir ? `<span class="num-dir">${ev.year.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.diff.status}" data-label="난이도">
          ${mobileLabel("diff", "난이도")}
          <span class="num-val">${guess.diff.toFixed(2)}</span>
          ${ev.diff.dir ? `<span class="num-dir">${ev.diff.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.minP.status}" data-label="최소 인원">
          ${mobileLabel("minP", "최소 인원")}
          <span class="num-val">${guess.minP}명</span>
          ${ev.minP.dir ? `<span class="num-dir">${ev.minP.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.maxP.status}" data-label="최대 인원">
          ${mobileLabel("maxP", "최대 인원")}
          <span class="num-val">${guess.maxP}명</span>
          ${ev.maxP.dir ? `<span class="num-dir">${ev.maxP.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.time.status}" data-label="플레이 타임">
          ${mobileLabel("time", "플레이 타임")}
          <span class="num-val">${guess.timeStr}</span>
          ${ev.time.dir ? `<span class="num-dir">${ev.time.dir}</span>` : ""}
        </td>
        <td class="cell ${ev.mech.status}" data-label="메커니즘">
          ${mobileLabel("mech", "메커니즘")}
          <div class="tag-list">${mechHtml}</div>
        </td>
        <td class="cell ${ev.theme.status}" data-label="테마">
          ${mobileLabel("theme", "테마")}
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
    } else if (state.guesses.length < 3 && isInputActive()) {
      el.hintCounter.textContent = "힌트: 3회 시도 후 해금";
    } else {
      el.hintCounter.textContent = `힌트: ${totalHints} / ${allowedHints}개 사용`;
    }

    el.btnHintChoseong.disabled = !canSpend || h.choseongCount >= maxChars;
    el.btnHintChoseong.textContent = "🔤 초성 1글자";
    el.btnHintChoseong.classList.toggle("used", h.choseongCount > 0);

    el.btnHintDesigner.disabled = !canSpend || h.designer || !state.target.designer;
    el.btnHintDesigner.classList.toggle("used", h.designer);

    el.btnHintArt.disabled = !canSpend || h.art || !state.target.thumb;
    el.btnHintArt.textContent = state.target.thumb ? "🖼️ 박스아트(일부)" : "🖼️ 박스아트(없음)";
    el.btnHintArt.classList.toggle("used", h.art);

    el.btnHintAttrToggle.disabled = !canSpend;
    el.btnHintAttrToggle.classList.toggle("used", Object.keys(h.attrs).length > 0);

    // Attribute picker pills
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
          saveDailyState();
          renderHints();
        }
      });
    });

    // Hint Display Area
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
          <div class="hint-crop-wrap">
            <img class="hint-crop-img" src="${state.target.thumb}" alt="박스아트 일부" />
          </div>
          <div><strong>🖼️ 박스아트 일부:</strong> 이미지의 정중앙 영역입니다.</div>
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
          ${state.mode === "daily" ? `<button id="btn-share" class="btn-primary" type="button">📋 결과 공유</button>` : ""}
          ${state.target.url ? `<a class="btn-secondary" href="${state.target.url}" target="_blank" rel="noopener">보드라이프 보기</a>` : ""}
          ${state.mode === "endless" ? `<button id="btn-banner-new" class="btn-primary" type="button">🔄 다음 문제</button>` : ""}
        </div>
      `;

      const btnShare = document.getElementById("btn-share");
      if (btnShare) btnShare.addEventListener("click", shareDailyResult);
      const btnBannerNew = document.getElementById("btn-banner-new");
      if (btnBannerNew) btnBannerNew.addEventListener("click", () => startEndlessGame());
      el.resultBanner.classList.remove("hidden");
      return;
    }

    // Lost state (5 attempts used) and user hasn't chosen yet
    el.resultBanner.className = "result-banner loss";
    el.resultBanner.innerHTML = `
      <div class="result-info">
        <div>
          <div class="result-title">😢 5번의 시도를 모두 사용했습니다 (패배 · 힌트 ${hintCount}개)</div>
          <div class="result-sub">힌트를 활용하며 끝까지 풀어보거나, 정답을 바로 확인할 수 있습니다.</div>
        </div>
      </div>
      <div class="result-actions">
        ${!state.continueAfterLoss ? `<button id="btn-continue-practice" class="btn-primary" type="button">💡 계속 풀기</button>` : ""}
        <button id="btn-reveal-answer" class="btn-secondary" type="button">👀 정답 보기</button>
        ${state.mode === "daily" ? `<button id="btn-share" class="btn-secondary" type="button">📋 결과 공유</button>` : ""}
      </div>
    `;

    const btnCont = document.getElementById("btn-continue-practice");
    if (btnCont) {
      btnCont.addEventListener("click", () => {
        state.continueAfterLoss = true;
        saveDailyState();
        renderAll();
        el.searchInput.focus();
      });
    }
    const btnRev = document.getElementById("btn-reveal-answer");
    if (btnRev) {
      btnRev.addEventListener("click", () => {
        state.revealedAnswer = true;
        state.attrPickerOpen = false;
        saveDailyState();
        renderAll();
      });
    }
    const btnShare = document.getElementById("btn-share");
    if (btnShare) btnShare.addEventListener("click", shareDailyResult);

    el.resultBanner.classList.remove("hidden");
  }

  function renderAll() {
    renderGrid();
    renderClueBoard();
    renderHints();
    renderStatusAndBanner();
  }

  function shareDailyResult() {
    const dateKey = getTodayKey();
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
    const text = `🎲 BOARDLE ${dateKey} · ${score} · 💡힌트 ${hintCount}\n${rows.join("\n")}`;
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
        if (state.mode === "daily") recordDailyResult(true, state.guesses.length, getHintCount());
      } else if (state.guesses.length >= MAX_ATTEMPTS) {
        state.status = "lost";
        state.attrPickerOpen = false;
        if (state.mode === "daily") recordDailyResult(false, MAX_ATTEMPTS, getHintCount());
      }
    } else if (state.status === "lost" && state.continueAfterLoss && isCorrect) {
      state.revealedAnswer = true;
      state.attrPickerOpen = false;
    }

    saveDailyState();
    renderAll();
  }

  // Autocomplete
  function hideAutocomplete() {
    el.acList.classList.add("hidden");
    el.acList.innerHTML = "";
    state.acIndex = -1;
    state.acResults = [];
  }

  function updateAutocomplete(query) {
    const norm = normalizeQuery(query);
    if (!norm) {
      hideAutocomplete();
      return;
    }

    const guessedIds = new Set(state.guesses.map((g) => g.id));
    const matches = [];
    for (const g of ALL_GAMES) {
      if (guessedIds.has(g.id)) continue;
      const enNorm = normalizeQuery(g.en);
      if (
        matchesKoreanQuery(g.kr, norm) ||
        enNorm.includes(norm) ||
        (g.sk && matchesKoreanQuery(g.sk, norm))
      ) {
        matches.push(g);
        if (matches.length >= 12) break;
      }
    }

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
  function startDailyGame() {
    state.mode = "daily";
    el.btnDaily.classList.add("active");
    el.btnEndless.classList.remove("active");
    el.poolSelect.classList.add("hidden");
    el.btnNewGame.classList.add("hidden");

    const dateKey = getTodayKey();
    const target = pickDailyTarget(dateKey);
    state.target = target;
    state.guesses = [];
    state.status = "playing";
    state.continueAfterLoss = false;
    state.revealedAnswer = false;
    state.attrPickerOpen = false;
    state.hints = createEmptyHints();

    const saved = loadDailyState();
    if (saved && saved.targetId === target.id) {
      const byId = new Map(ALL_GAMES.map((g) => [g.id, g]));
      state.guesses = (saved.guessIds || []).map((id) => byId.get(id)).filter(Boolean);
      state.status = saved.status || "playing";
      state.continueAfterLoss = Boolean(saved.continueAfterLoss);
      state.revealedAnswer = Boolean(saved.revealedAnswer);
      state.hints = saved.hints || createEmptyHints();
    }

    el.searchInput.value = "";
    hideAutocomplete();
    renderAll();
  }

  function startEndlessGame() {
    state.mode = "endless";
    el.btnEndless.classList.add("active");
    el.btnDaily.classList.remove("active");
    el.poolSelect.classList.remove("hidden");
    el.btnNewGame.classList.remove("hidden");

    state.endlessPool = el.poolSelect.value || "normal";
    state.target = pickRandomTarget(state.endlessPool);
    state.guesses = [];
    state.status = "playing";
    state.continueAfterLoss = false;
    state.revealedAnswer = false;
    state.attrPickerOpen = false;
    state.hints = createEmptyHints();

    el.searchInput.value = "";
    hideAutocomplete();
    renderAll();
  }

  function renderStatsModal() {
    const s = loadStats();
    const winRate = s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0;
    const avgHints = s.wins > 0 ? (s.totalHintsOnWins / s.wins).toFixed(1) : "0.0";
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
        <div class="stat-box"><div class="stat-num">${s.streak}</div><div class="stat-lbl">현재 연승</div></div>
        <div class="stat-box"><div class="stat-num">${s.maxStreak}</div><div class="stat-lbl">최대 연승</div></div>
      </div>
      <div class="stats-grid stats-grid-sub">
        <div class="stat-box"><div class="stat-num">${s.noHintWins || 0}</div><div class="stat-lbl">노힌트 클리어</div></div>
        <div class="stat-box"><div class="stat-num">${avgHints}</div><div class="stat-lbl">평균 힌트 (승리 시)</div></div>
      </div>
      <p style="font-weight:700; margin-bottom:8px;">시도 횟수 분포 (5회 이내)</p>
      ${distHtml}
    `;
  }

  // Event Listeners
  function bindEvents() {
    el.btnDaily.addEventListener("click", startDailyGame);
    el.btnEndless.addEventListener("click", startEndlessGame);
    el.poolSelect.addEventListener("change", startEndlessGame);
    el.btnNewGame.addEventListener("click", startEndlessGame);

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

    let pinnedHelpBtn = null;

    function showAttrTooltip(btn, key) {
      const info = ATTR_HELP_MAP[key];
      if (!info) return;
      el.attrPopover.innerHTML = `<div class="attr-tooltip-title">${info.title}</div><div>${info.body}</div>`;
      el.attrPopover.classList.remove("hidden");

      const rect = btn.getBoundingClientRect();
      const popRect = el.attrPopover.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - popRect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
      let top = rect.bottom + 8;
      if (top + popRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - popRect.height - 8);
      }
      el.attrPopover.style.left = `${left}px`;
      el.attrPopover.style.top = `${top}px`;
    }

    function hideAttrTooltip() {
      el.attrPopover.classList.add("hidden");
      if (pinnedHelpBtn) {
        pinnedHelpBtn.classList.remove("active");
        pinnedHelpBtn = null;
      }
    }

    document.addEventListener("mouseover", (e) => {
      const btn = e.target.closest(".attr-help-btn");
      if (!btn || pinnedHelpBtn) return;
      showAttrTooltip(btn, btn.dataset.helpAttr);
    });

    document.addEventListener("mouseout", (e) => {
      const btn = e.target.closest(".attr-help-btn");
      if (!btn || pinnedHelpBtn) return;
      hideAttrTooltip();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-box-wrap")) {
        hideAutocomplete();
      }
      const helpBtn = e.target.closest(".attr-help-btn");
      if (helpBtn) {
        e.stopPropagation();
        if (pinnedHelpBtn === helpBtn) {
          hideAttrTooltip();
        } else {
          hideAttrTooltip();
          pinnedHelpBtn = helpBtn;
          helpBtn.classList.add("active");
          showAttrTooltip(helpBtn, helpBtn.dataset.helpAttr);
        }
      } else if (pinnedHelpBtn) {
        hideAttrTooltip();
      }
    });

    el.btnHintChoseong.addEventListener("click", () => {
      const maxChars = getChoseongChars(state.target.kr).length;
      if (canSpendHint() && state.hints.choseongCount < maxChars) {
        state.hints.choseongCount += 1;
        saveDailyState();
        renderHints();
      }
    });

    el.btnHintDesigner.addEventListener("click", () => {
      if (canSpendHint() && !state.hints.designer) {
        state.hints.designer = true;
        saveDailyState();
        renderHints();
      }
    });

    el.btnHintArt.addEventListener("click", () => {
      if (canSpendHint() && !state.hints.art && state.target.thumb) {
        state.hints.art = true;
        saveDailyState();
        renderHints();
      }
    });

    el.btnHintAttrToggle.addEventListener("click", () => {
      if (!canSpendHint()) return;
      state.attrPickerOpen = !state.attrPickerOpen;
      renderHints();
    });

    const btnResetDaily = document.getElementById("btn-reset-daily");
    if (btnResetDaily) {
      btnResetDaily.addEventListener("click", () => {
        localStorage.removeItem("boardle_daily_v2");
        localStorage.removeItem("boardle_stats_v1");
        el.modalStats.classList.add("hidden");
        startDailyGame();
        showToast("오늘의 게임 기록이 초기화되었습니다.");
      });
    }

    el.btnHelp.addEventListener("click", () => el.modalHelp.classList.remove("hidden"));
    el.btnStats.addEventListener("click", () => {
      renderStatsModal();
      el.modalStats.classList.remove("hidden");
    });

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById(btn.dataset.close).classList.add("hidden");
      });
    });

    [el.modalHelp, el.modalStats].forEach((modal) => {
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
    startDailyGame();
  }

  init();
})();
