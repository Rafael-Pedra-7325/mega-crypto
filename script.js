(() => {
  'use strict';

  // Constantes oficiais da Mega-Sena
  const TOTAL_NUMBERS = 60;
  const TOTAL_COMBINATIONS = 50063860; // C(60, 6)
  const STORAGE_KEY = 'mega_crypto_history_v1';

  // Estado da aplicação
  const state = {
    numbersPerGame: 6,
    gamesCount: 1,
    basePrice: 6.0,
    fixedNumbers: new Set(),
    excludedNumbers: new Set(),
    lastDrawnUnion: new Set(),
    currentGames: [],
    history: loadHistory(),
    soundEnabled: true,
    officialNumbers: new Set()
  };

  // Elementos do DOM
  const els = {
    numbersCount: document.getElementById('numbersCount'),
    numbersCountVal: document.getElementById('numbersCountVal'),
    gamesCount: document.getElementById('gamesCount'),
    gamesCountVal: document.getElementById('gamesCountVal'),
    basePrice: document.getElementById('basePrice'),
    totalCost: document.getElementById('totalCost'),
    winOdds: document.getElementById('winOdds'),
    combinationsCount: document.getElementById('combinationsCount'),
    volanteGrid: document.getElementById('volanteGrid'),
    fixedCounter: document.getElementById('fixedCounter'),
    excludedCounter: document.getElementById('excludedCounter'),
    clearVolanteBtn: document.getElementById('clearVolanteBtn'),
    generateBtn: document.getElementById('generateBtn'),
    resultsContainer: document.getElementById('resultsContainer'),
    copyCurrentBtn: document.getElementById('copyCurrentBtn'),
    saveAllBtn: document.getElementById('saveAllBtn'),
    historyList: document.getElementById('historyList'),
    exportTxtBtn: document.getElementById('exportTxtBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    officialResult: document.getElementById('officialResult'),
    clearCheckerBtn: document.getElementById('clearCheckerBtn'),
    soundToggle: document.getElementById('soundToggle'),
    entropyStatus: document.getElementById('entropyStatus'),
    toast: document.getElementById('toast')
  };

  /* =====================================================
     1. ALEATORIEDADE REAL (CSPRNG + REJECTION SAMPLING)
  ===================================================== */

  function hasCryptoSupport() {
    return typeof window !== 'undefined' &&
      window.crypto &&
      typeof window.crypto.getRandomValues === 'function';
  }

  /**
   * Retorna um inteiro criptograficamente seguro em [0, max - 1]
   * usando Rejection Sampling para evitar modulo bias.
   */
  function secureRandomInt(max) {
    if (max <= 0) throw new Error('Max deve ser positivo.');
    const array = new Uint32Array(1);
    const maxUint32 = 0xffffffff;
    const limit = maxUint32 - ((maxUint32 + 1) % max);

    let randomValue;
    do {
      window.crypto.getRandomValues(array);
      randomValue = array[0];
    } while (randomValue > limit);

    return randomValue % max;
  }

  /**
   * Embaralhamento Fisher-Yates usando CSPRNG
   */
  function secureShuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = secureRandomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateSingleGame() {
    const fixed = Array.from(state.fixedNumbers);
    const needed = state.numbersPerGame - fixed.length;

    const pool = [];
    for (let n = 1; n <= TOTAL_NUMBERS; n++) {
      if (!state.fixedNumbers.has(n) && !state.excludedNumbers.has(n)) {
        pool.push(n);
      }
    }

    const shuffled = secureShuffle(pool);
    const picked = shuffled.slice(0, needed);
    return [...fixed, ...picked].sort((a, b) => a - b);
  }

  /* =====================================================
     2. MATEMÁTICA E ESTATÍSTICAS
  ===================================================== */

  function combinations(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let res = 1;
    for (let i = 1; i <= k; i++) {
      res = (res * (n - i + 1)) / i;
    }
    return Math.round(res);
  }

  function isPrime(num) {
    if (num < 2) return false;
    for (let i = 2; i * i <= num; i++) {
      if (num % i === 0) return false;
    }
    return true;
  }

  function analyzeGame(numbers) {
    const evens = numbers.filter((n) => n % 2 === 0).length;
    const odds = numbers.length - evens;
    const sum = numbers.reduce((acc, n) => acc + n, 0);
    const primes = numbers.filter(isPrime).length;
    return { evens, odds, sum, primes };
  }

  function formatNumber(n) {
    return String(n).padStart(2, '0');
  }

  function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function updateMetrics() {
    const combPerGame = combinations(state.numbersPerGame, 6);
    const totalCombs = combPerGame * state.gamesCount;
    const cost = totalCombs * state.basePrice;
    const odds = Math.max(1, Math.round(TOTAL_COMBINATIONS / totalCombs));

    els.totalCost.textContent = formatCurrency(cost);
    els.combinationsCount.textContent = totalCombs.toLocaleString('pt-BR');
    els.winOdds.textContent = `1 em ${odds.toLocaleString('pt-BR')}`;
  }

  /* =====================================================
     3. EFEITOS SONOROS (WEB AUDIO API)
  ===================================================== */

  let audioCtx = null;

  function playTone(freq = 520, duration = 0.08, type = 'sine', volume = 0.05) {
    if (!state.soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Ignora bloqueios de áudio do navegador
    }
  }

  function playDrawSequence() {
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 0.09, 'triangle', 0.05), idx * 55);
    });
  }

  /* =====================================================
     4. VOLANTE INTERATIVO
  ===================================================== */

  function buildVolante() {
    els.volanteGrid.innerHTML = '';
    for (let i = 1; i <= TOTAL_NUMBERS; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v-cell';
      btn.dataset.num = i;
      btn.textContent = formatNumber(i);
      btn.addEventListener('click', () => cycleVolanteNumber(i));
      els.volanteGrid.appendChild(btn);
    }
    syncVolanteUI();
  }

  function cycleVolanteNumber(num) {
    if (state.fixedNumbers.has(num)) {
      state.fixedNumbers.delete(num);
      state.excludedNumbers.add(num);
      playTone(260, 0.06, 'sawtooth', 0.03);
    } else if (state.excludedNumbers.has(num)) {
      state.excludedNumbers.delete(num);
      playTone(380, 0.05, 'sine', 0.03);
    } else {
      if (state.fixedNumbers.size >= state.numbersPerGame) {
        showToast(`Você já fixou o limite de ${state.numbersPerGame} dezenas para este jogo.`);
        return;
      }
      state.fixedNumbers.add(num);
      playTone(620, 0.06, 'triangle', 0.04);
    }
    syncVolanteUI();
  }

  function syncVolanteUI() {
    els.fixedCounter.textContent = state.fixedNumbers.size;
    els.excludedCounter.textContent = state.excludedNumbers.size;

    const cells = els.volanteGrid.querySelectorAll('.v-cell');
    cells.forEach((cell) => {
      const num = Number(cell.dataset.num);
      cell.classList.toggle('is-fixed', state.fixedNumbers.has(num));
      cell.classList.toggle('is-excluded', state.excludedNumbers.has(num));
      cell.classList.toggle('is-drawn', state.lastDrawnUnion.has(num));
    });
  }

  /* =====================================================
     5. GERAÇÃO E RENDERIZAÇÃO DE RESULTADOS
  ===================================================== */

  function handleGenerate() {
    if (!hasCryptoSupport()) {
      showToast('Seu navegador não suporta a Web Crypto API.');
      return;
    }

    if (state.fixedNumbers.size > state.numbersPerGame) {
      showToast(`Remova dezenas fixas ou aumente a quantidade para pelo menos ${state.fixedNumbers.size}.`);
      return;
    }

    const available = TOTAL_NUMBERS - state.excludedNumbers.size;
    if (available < state.numbersPerGame) {
      showToast(`Há poucas dezenas disponíveis (${available}). Libere alguns números excluídos.`);
      return;
    }

    const generated = [];
    const seenKeys = new Set();
    let attempts = 0;

    while (generated.length < state.gamesCount && attempts < 200) {
      attempts++;
      const game = generateSingleGame();
      const key = game.join('-');
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        generated.push({
          id: `${Date.now()}-${generated.length}`,
          numbers: game,
          fixedUsed: Array.from(state.fixedNumbers),
          timestamp: new Date().toLocaleString('pt-BR')
        });
      }
    }

    state.currentGames = generated;
    state.lastDrawnUnion = new Set(generated.flatMap((g) => g.numbers));

    playDrawSequence();
    syncVolanteUI();
    renderCurrentResults();

    els.copyCurrentBtn.disabled = false;
    els.saveAllBtn.disabled = false;
  }

  function renderCurrentResults() {
    if (!state.currentGames.length) {
      els.resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-orb">🎲</div>
          <p>Clique em <strong>Gerar Dezenas</strong> para iniciar a coleta de entropia criptográfica.</p>
        </div>
      `;
      return;
    }

    els.resultsContainer.innerHTML = '';

    state.currentGames.forEach((game, idx) => {
      const stats = analyzeGame(game.numbers);
      const card = document.createElement('div');
      card.className = 'game-card';

      const ballsHtml = game.numbers
        .map((n) => {
          const isFixed = game.fixedUsed.includes(n);
          return `<span class="ball ${isFixed ? 'ball-fixed' : ''}" title="${isFixed ? 'Dezena Fixada' : 'Sorteada via CSPRNG'}">${formatNumber(n)}</span>`;
        })
        .join('');

      card.innerHTML = `
        <div class="game-card-top">
          <span class="game-title">JOGO #${formatNumber(idx + 1)} • ${game.numbers.length} DEZENAS</span>
          <button class="btn-ghost btn-sm copy-single-btn">Copiar</button>
        </div>
        <div class="balls-row">${ballsHtml}</div>
        <div class="game-stats">
          <span class="stat-pill">Pares: ${stats.evens} / Ímpares: ${stats.odds}</span>
          <span class="stat-pill">Soma: ${stats.sum}</span>
          <span class="stat-pill">Primos: ${stats.primes}</span>
        </div>
      `;

      card.querySelector('.copy-single-btn').addEventListener('click', () => {
        copyText(game.numbers.map(formatNumber).join(' - '), `Jogo #${idx + 1} copiado!`);
      });

      els.resultsContainer.appendChild(card);
    });
  }

  /* =====================================================
     6. HISTÓRICO, CONFERIDOR E EXPORTAÇÃO
  ===================================================== */

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function persistHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history));
    } catch {
      showToast('Não foi possível salvar no armazenamento local.');
    }
  }

  function saveCurrentGamesToHistory() {
    if (!state.currentGames.length) return;
    state.history = [...state.currentGames, ...state.history].slice(0, 100);
    persistHistory();
    renderHistory();
    showToast(`${state.currentGames.length} jogo(s) salvo(s) no histórico!`);
    els.saveAllBtn.disabled = true;
  }

  function parseOfficialInput(value) {
    const matches = value.match(/\d+/g) || [];
    const valid = new Set();
    for (const token of matches) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= TOTAL_NUMBERS) {
        valid.add(n);
      }
      if (valid.size === 6) break;
    }
    return valid;
  }

  function getHitBadgeLabel(hits) {
    if (hits >= 6) return `🏆 SENA (${hits} acertos)`;
    if (hits === 5) return `🔥 QUINA (5 acertos)`;
    if (hits === 4) return `✨ QUADRA (4 acertos)`;
    return `${hits} acerto${hits === 1 ? '' : 's'}`;
  }

  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = `
        <div class="empty-state compact">
          <p>Nenhum jogo salvo ainda.</p>
        </div>
      `;
      return;
    }

    const checkingActive = state.officialNumbers.size > 0;
    els.historyList.innerHTML = '';

    state.history.forEach((item) => {
      const hits = checkingActive
        ? item.numbers.filter((n) => state.officialNumbers.has(n)).length
        : 0;

      const card = document.createElement('div');
      card.className = 'game-card';

      const ballsHtml = item.numbers
        .map((n) => {
          let cls = 'ball ball-sm';
          if (checkingActive) {
            cls += state.officialNumbers.has(n) ? ' ball-hit' : ' ball-miss';
          }
          return `<span class="${cls}">${formatNumber(n)}</span>`;
        })
        .join('');

      const badgeHtml = checkingActive
        ? `<span class="hit-badge ${hits >= 4 ? 'win' : ''}">${getHitBadgeLabel(hits)}</span>`
        : `<button class="btn-ghost btn-sm delete-item-btn" title="Remover jogo">✕</button>`;

      card.innerHTML = `
        <div class="game-card-top">
          <span class="game-title">${item.timestamp}</span>
          ${badgeHtml}
        </div>
        <div class="balls-row">${ballsHtml}</div>
      `;

      const delBtn = card.querySelector('.delete-item-btn');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          state.history = state.history.filter((h) => h.id !== item.id);
          persistHistory();
          renderHistory();
        });
      }

      els.historyList.appendChild(card);
    });
  }

  function exportHistoryTxt() {
    if (!state.history.length) {
      showToast('Salve pelo menos um jogo no histórico antes de exportar.');
      return;
    }

    const lines = [
      '=== MEGA//CRYPTO — JOGOS SALVOS ===',
      `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
      ''
    ];

    state.history.forEach((item, idx) => {
      lines.push(`Jogo ${formatNumber(idx + 1)} (${item.timestamp}): ${item.numbers.map(formatNumber).join(' - ')}`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mega-sena-jogos-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Arquivo .TXT baixado!');
  }

  /* =====================================================
     7. UTILITÁRIOS E EVENTOS
  ===================================================== */

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(successMsg));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(successMsg);
    }
  }

  let toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function bindEvents() {
    els.numbersCount.addEventListener('input', (e) => {
      state.numbersPerGame = Number(e.target.value);
      els.numbersCountVal.textContent = state.numbersPerGame;
      updateMetrics();
    });

    els.gamesCount.addEventListener('input', (e) => {
      state.gamesCount = Number(e.target.value);
      els.gamesCountVal.textContent = state.gamesCount;
      updateMetrics();
    });

    els.basePrice.addEventListener('input', (e) => {
      const parsed = parseFloat(e.target.value);
      state.basePrice = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      updateMetrics();
    });

    els.clearVolanteBtn.addEventListener('click', () => {
      state.fixedNumbers.clear();
      state.excludedNumbers.clear();
      syncVolanteUI();
      showToast('Filtros do volante limpos.');
    });

    els.generateBtn.addEventListener('click', handleGenerate);

    els.copyCurrentBtn.addEventListener('click', () => {
      const text = state.currentGames
        .map((g, i) => `Jogo ${i + 1}: ${g.numbers.map(formatNumber).join(' - ')}`)
        .join('\n');
      copyText(text, 'Todos os jogos gerados foram copiados!');
    });

    els.saveAllBtn.addEventListener('click', saveCurrentGamesToHistory);
    els.exportTxtBtn.addEventListener('click', exportHistoryTxt);

    els.clearHistoryBtn.addEventListener('click', () => {
      if (!state.history.length) return;
      state.history = [];
      persistHistory();
      renderHistory();
      showToast('Histórico apagado.');
    });

    els.officialResult.addEventListener('input', (e) => {
      state.officialNumbers = parseOfficialInput(e.target.value);
      renderHistory();
    });

    els.clearCheckerBtn.addEventListener('click', () => {
      els.officialResult.value = '';
      state.officialNumbers.clear();
      renderHistory();
    });

    els.soundToggle.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      els.soundToggle.textContent = state.soundEnabled ? '🔊' : '🔇';
      showToast(state.soundEnabled ? 'Efeitos sonoros ativados.' : 'Efeitos sonoros silenciados.');
    });
  }

  // Inicialização
  function init() {
    if (!hasCryptoSupport()) {
      els.entropyStatus.textContent = 'CRYPTO INDISPONÍVEL';
      els.entropyStatus.style.color = '#ff4d6d';
    }
    buildVolante();
    updateMetrics();
    renderHistory();
    bindEvents();
  }

  init();
})();
