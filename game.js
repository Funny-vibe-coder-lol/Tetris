(() => {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;
  const COLORS = { I: '#63d9e8', O: '#f5cf62', T: '#b28af5', S: '#76d6a1', Z: '#f47c91', J: '#7298f5', L: '#f4a267' };
  const SHAPES = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
  };

  const boardCanvas = document.querySelector('#board');
  const ctx = boardCanvas.getContext('2d');
  const nextCanvas = document.querySelector('#next');
  const nextCtx = nextCanvas.getContext('2d');
  const scoreNode = document.querySelector('#score');
  const linesNode = document.querySelector('#lines');
  const levelNode = document.querySelector('#level');
  const tetrisRateNode = document.querySelector('#tetris-rate');
  const bestNode = document.querySelector('#best');
  const overlay = document.querySelector('#overlay');
  const overlayKicker = document.querySelector('#overlay-kicker');
  const overlayTitle = document.querySelector('#overlay-title');
  const overlayText = document.querySelector('#overlay-text');
  const startButton = document.querySelector('#start-button');

  let grid;
  let current;
  let nextType;
  let score = 0;
  let lines = 0;
  let tetrisLines = 0;
  let level = 1;
  let speedTier = 0;
  let best = loadBest();
  let state = 'ready';
  let lastTick = 0;
  let dropAccumulator = 0;
  let bag = [];
  let clearAnimation = null;
  let audioContext = null;

  function playTone(frequency, duration = 0.07, type = 'sine', volume = 0.035) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch { /* sound is optional when audio is unavailable */ }
  }

  function loadBest() {
    try { return Number(localStorage.getItem('blockfall-best')) || 0; }
    catch { return 0; }
  }

  function makeGrid() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }

  function nextFromBag() {
    if (!bag.length) {
      bag = Object.keys(SHAPES);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }

  function makePiece(type) {
    const shape = SHAPES[type].map(row => [...row]);
    return { type, shape, x: Math.floor((COLS - shape[0].length) / 2), y: 0 };
  }

  function spawn() {
    current = makePiece(nextType || nextFromBag());
    nextType = nextFromBag();
    drawNext();
    if (collides(current, 0, 0, current.shape)) finishGame();
  }

  function collides(piece, dx, dy, shape) {
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        const px = piece.x + x + dx;
        const py = piece.y + y + dy;
        if (px < 0 || px >= COLS || py >= ROWS) return true;
        if (py >= 0 && grid[py][px]) return true;
      }
    }
    return false;
  }

  function rotate(shape) {
    return shape[0].map((_, x) => shape.map(row => row[x]).reverse());
  }

  function tryRotate() {
    const rotated = rotate(current.shape);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(current, kick, 0, rotated)) {
        current.x += kick;
        current.shape = rotated;
        playTone(420, 0.06, 'triangle', 0.025);
        draw();
        return;
      }
    }
  }

  function move(dx, dy) {
    if (clearAnimation) return false;
    if (!collides(current, dx, dy, current.shape)) {
      current.x += dx;
      current.y += dy;
      draw();
      return true;
    }
    if (dy > 0) lockPiece();
    return false;
  }

  function lockPiece() {
    current.shape.forEach((row, y) => row.forEach((cell, x) => {
      const gy = current.y + y;
      if (cell && gy >= 0) grid[gy][current.x + x] = current.type;
    }));
    current = null;
    if (beginLineClear()) return;
    playTone(130, 0.06, 'triangle', 0.025);
    if (state === 'playing') spawn();
    draw();
  }

  function beginLineClear() {
    const rows = grid.map((row, y) => row.every(Boolean) ? y : -1).filter(y => y >= 0);
    if (!rows.length) return false;
    if (rows.length === 3) rows.reverse();
    const particles = rows.length === 4
      ? rows.flatMap(y => grid[y].map((type, x) => ({
        x, y, type,
        vx: (x - (COLS - 1) / 2) * (0.8 + Math.random() * 0.55),
        vy: (y - (ROWS - 1) / 2) * (0.65 + Math.random() * 0.45),
      })))
      : [];
    clearAnimation = { rows, count: rows.length, started: performance.now(), duration: rows.length === 3 ? 1350 : 560, particles };
    playClearSound(rows.length);
    draw();
    return true;
  }

  function playClearSound(count) {
    const root = count === 4 ? 660 : count === 3 ? 520 : count === 2 ? 420 : 340;
    playTone(root, count === 4 ? 0.3 : 0.15, count === 4 ? 'sawtooth' : 'triangle', 0.045);
    playTone(root * 1.25, count === 4 ? 0.34 : 0.17, 'sine', 0.025);
  }

  function finishLineClear() {
    const { rows, count } = clearAnimation;
    const clearedRows = new Set(rows);
    clearAnimation = null;
    grid = grid.filter((_, y) => !clearedRows.has(y));
    while (grid.length < ROWS) grid.unshift(Array(COLS).fill(null));
    lines += count;
    if (count === 4) tetrisLines += 4;
    const linePoints = count * 100 * (count > 1 ? 1.1 : 1);
    score += Math.round(linePoints * (1 + 0.05 * speedTier));
    level = Math.floor(lines / 10) + 1;
    speedTier = Math.floor(score / 5000);
    if (score > best) {
      best = score;
      try { localStorage.setItem('blockfall-best', String(best)); } catch { /* storage is optional */ }
    }
    updateStats();
    if (score >= 50000) celebrateWin();
    if (state === 'playing') spawn();
    draw();
  }

  function updateStats() {
    scoreNode.textContent = String(score).padStart(5, '0');
    linesNode.textContent = String(lines);
    levelNode.textContent = String(level);
    tetrisRateNode.textContent = `${lines ? Math.round((tetrisLines / lines) * 100) : 0}%`;
    bestNode.textContent = String(best).padStart(5, '0');
  }

  function drawCell(context, x, y, size, color, alpha = 1) {
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.fillStyle = '#ffffff24';
    context.fillRect(x * size + 3, y * size + 3, size - 6, 2);
    context.fillStyle = '#00000020';
    context.fillRect(x * size + 3, y * size + size - 5, size - 6, 2);
    context.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.fillStyle = '#111522';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.strokeStyle = '#ffffff0a';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, ROWS * CELL); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(COLS * CELL, y * CELL + .5); ctx.stroke(); }
    const animatedRows = clearAnimation ? new Set(clearAnimation.rows) : null;
    if (grid) grid.forEach((row, y) => {
      if (animatedRows?.has(y)) return;
      row.forEach((type, x) => { if (type) drawCell(ctx, x, y, CELL, COLORS[type]); });
    });
    if (clearAnimation) drawLineClear(performance.now());
    if (!current) {
      if (state === 'won') drawDancer();
      return;
    }
    let ghostY = current.y;
    while (!collides(current, 0, ghostY - current.y + 1, current.shape)) ghostY++;
    current.shape.forEach((row, y) => row.forEach((cell, x) => {
      if (cell && ghostY + y >= 0) drawCell(ctx, current.x + x, ghostY + y, CELL, COLORS[current.type], .18);
    }));
    current.shape.forEach((row, y) => row.forEach((cell, x) => {
      if (cell && current.y + y >= 0) drawCell(ctx, current.x + x, current.y + y, CELL, COLORS[current.type]);
    }));
  }

  function drawLineClear(now) {
    const { rows, count, started, duration, particles } = clearAnimation;
    const progress = Math.min(1, Math.max(0, (now - started) / duration));
    if (count === 1 || count === 2) {
      const amount = progress * COLS;
      rows.forEach(y => grid[y].forEach((type, x) => {
        const order = count === 1 ? x : COLS - 1 - x;
        const alpha = 1 - Math.max(0, Math.min(1, amount - order));
        if (alpha > 0) drawCell(ctx, x, y, CELL, COLORS[type], alpha);
      }));
      return;
    }
    if (count === 3) {
      const stage = progress * count;
      rows.forEach((y, index) => {
        const fall = Math.max(0, Math.min(1, stage - index));
        const offset = fall * ROWS;
        grid[y].forEach((type, x) => {
          const drawY = y + offset;
          if (drawY < ROWS) drawCell(ctx, x, drawY, CELL, COLORS[type], 1 - fall * 0.25);
        });
      });
      return;
    }
    if (count === 4) {
      particles.forEach(particle => {
        const px = (particle.x + 0.5) * CELL + particle.vx * progress * 175;
        const py = (particle.y + 0.5) * CELL + particle.vy * progress * 175 + 220 * progress * progress;
        const alpha = 1 - progress;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLORS[particle.type];
        ctx.fillRect(px - 7, py - 7, 14, 14);
        ctx.fillStyle = '#ffffff70';
        ctx.fillRect(px - 5, py - 5, 10, 2);
      });
      ctx.globalAlpha = 1;
    }
  }

  function drawDancer() {
    const danceFrame = Math.floor(performance.now() / 180) % 2;
    const blocks = danceFrame
      ? [[0,5,'O'],[0,7,'T'],[-1,7,'I'],[1,6,'S'],[0,8,'Z'],[-1,9,'J'],[1,9,'L']]
      : [[0,5,'O'],[0,7,'T'],[-1,6,'S'],[1,7,'I'],[0,8,'Z'],[-1,9,'L'],[1,9,'J']];
    const centerX = Math.floor(COLS / 2);
    ctx.fillStyle = '#111522ed';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c4b5fd';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText('ПОБЕДА!', boardCanvas.width / 2, 100);
    ctx.fillStyle = '#e8e8f2';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('50 000 очков — поздравляем!', boardCanvas.width / 2, 126);
    blocks.forEach(([x, y, type]) => drawCell(ctx, centerX + x, y, CELL, COLORS[type]));
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextType) return;
    const shape = SHAPES[nextType];
    const size = 20;
    const offsetX = (nextCanvas.width - shape[0].length * size) / 2;
    const offsetY = (nextCanvas.height - shape.length * size) / 2;
    shape.forEach((row, y) => row.forEach((cell, x) => {
      if (!cell) return;
      nextCtx.fillStyle = COLORS[nextType];
      nextCtx.fillRect(offsetX + x * size + 1, offsetY + y * size + 1, size - 2, size - 2);
      nextCtx.fillStyle = '#ffffff24';
      nextCtx.fillRect(offsetX + x * size + 3, offsetY + y * size + 3, size - 6, 2);
    }));
  }

  function showOverlay(kicker, title, text, button) {
    overlayKicker.textContent = kicker;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startButton.innerHTML = `<span>▶</span> ${button}`;
    overlay.classList.remove('hidden');
  }

  function startGame() {
    grid = makeGrid();
    clearAnimation = null;
    score = 0;
    lines = 0;
    tetrisLines = 0;
    level = 1;
    bag = [];
    current = null;
    nextType = nextFromBag();
    state = 'playing';
    dropAccumulator = 0;
    lastTick = performance.now();
    playTone(320, 0.1, 'triangle', 0.03);
    updateStats();
    spawn();
    if (state === 'playing') overlay.classList.add('hidden');
    draw();
  }

  function finishGame() {
    state = 'over';
    showOverlay('ИГРА ОКОНЧЕНА', 'Отличная игра!', `Счёт: ${score}. Попробуй побить свой рекорд.`, 'Играть снова');
  }

  function celebrateWin() {
    state = 'won';
    current = null;
    overlay.classList.add('hidden');
    draw();
  }

  function togglePause() {
    if (state === 'playing' && clearAnimation) return;
    if (state === 'playing') {
      state = 'paused';
      showOverlay('ПАУЗА', 'Передышка', 'Нажми пробел, чтобы продолжить игру.', 'Продолжить');
    } else if (state === 'paused') {
      state = 'playing';
      lastTick = performance.now();
      overlay.classList.add('hidden');
    }
  }

  function tick(now) {
    const elapsed = Math.min(now - lastTick, 100);
    lastTick = now;
    if (state === 'playing' && clearAnimation) {
      if (now - clearAnimation.started >= clearAnimation.duration) finishLineClear();
      else draw();
    } else if (state === 'playing') {
      dropAccumulator += elapsed;
      const baseInterval = (850 / 0.7) - (level - 1) * 65;
      const interval = Math.max(70, baseInterval / (1.05 ** speedTier));
      if (dropAccumulator >= interval) {
        dropAccumulator %= interval;
        move(0, 1);
      }
    } else if (state === 'won') draw();
    requestAnimationFrame(tick);
  }

  document.addEventListener('keydown', event => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '];
    if (keys.includes(event.key)) event.preventDefault();
    if (event.key === ' ' && (state === 'playing' || state === 'paused')) { togglePause(); return; }
    if (state !== 'playing') return;
    if (clearAnimation) return;
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') { if (move(-1, 0)) playTone(250, 0.045, 'square', 0.018); }
    else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') { if (move(1, 0)) playTone(280, 0.045, 'square', 0.018); }
    else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') { if (move(0, 1)) playTone(175, 0.04, 'triangle', 0.018); }
    else if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') tryRotate();
  });

  startButton.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
  });
  document.querySelector('#restart-button').addEventListener('click', startGame);
  bestNode.textContent = String(best).padStart(5, '0');
  grid = makeGrid();
  current = null;
  updateStats();
  draw();
  requestAnimationFrame(tick);
})();
