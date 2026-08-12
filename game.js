/**
 * Crapette Rapide - Jeu de cartes à 2 joueurs
 * Modes : solo (contre l'ordinateur) et en ligne (PeerJS, code de partie)
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const RED_SUITS = new Set(['♥', '♦']);

const AI_DELAY_MIN = 1300;
const AI_DELAY_MAX = 2700;
const AI_MOVE_PAUSE = 800;
const NET_SYNC_MS = 80;

let gameState = null;
let layoutTimer = null;
let aiTimeout = null;
let dragState = null;
let pendingGuestState = null;
let renderPending = false;
let netSyncTimer = null;
let lastRevealedId = null;
let pendingRender = false;
let flipCountdownTimer = null;
let pendingFlyAnims = [];

function updateViewportLayout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw <= 768;
  const short = vh < 740;
  const root = document.documentElement;

  const header = document.querySelector('.header');
  const msg = document.getElementById('message-bar');
  const footer = document.querySelector('.footer');
  const app = document.getElementById('app');

  const padY = mobile ? 4 : 10;
  let chromeH = mobile ? 72 : 108;
  if (header && app) {
    chromeH = (header.offsetHeight || 0)
      + (msg?.offsetHeight || 0)
      + (footer?.offsetHeight || 0)
      + padY * 2;
  }

  const playing = gameState && (gameState.phase === 'playing' || gameState.phase === 'countdown');
  if (mobile && playing) {
    chromeH -= footer?.offsetHeight || 16;
  }

  const availableH = Math.max(240, vh - chromeH);
  const playerInfoH = (mobile && playing) ? 0 : (mobile ? 12 : 18);
  const centerPad = mobile ? 6 : 12;
  const tableGap = mobile ? 2 : 6;

  let stackOffset = mobile ? 4 : (short ? 8 : 12);
  const fixed = 2 * playerInfoH + 8 * stackOffset + 2 * centerPad + 2 * tableGap;
  let cardH = Math.floor((availableH - fixed) / 3);

  const colGap = mobile ? 2 : 5;
  const zoneGap = mobile ? 2 : 12;
  const usableW = vw - (mobile ? 4 : 16);
  const maxCardW = Math.floor((usableW - zoneGap - colGap * 4) / 6);

  let cardW = Math.round(cardH * 0.706);
  if (cardW > maxCardW) {
    cardW = maxCardW;
    cardH = Math.round(cardW / 0.706);
  }

  cardW = Math.max(mobile ? 32 : 44, cardW);
  cardH = Math.max(mobile ? 46 : 58, cardH);

  let totalH = 2 * (playerInfoH + cardH + 4 * stackOffset) + cardH + 2 * centerPad + 2 * tableGap;
  while (totalH > availableH && stackOffset > 2) {
    stackOffset -= 1;
    const fixed2 = 2 * playerInfoH + 8 * stackOffset + 2 * centerPad + 2 * tableGap;
    cardH = Math.floor((availableH - fixed2) / 3);
    cardW = Math.max(mobile ? 32 : 44, Math.round(cardH * 0.706));
    if (cardW > maxCardW) {
      cardW = maxCardW;
      cardH = Math.round(cardW / 0.706);
    }
    totalH = 2 * (playerInfoH + cardH + 4 * stackOffset) + cardH + 2 * centerPad + 2 * tableGap;
  }

  while (totalH > availableH && cardH > (mobile ? 42 : 54)) {
    cardH -= 2;
    cardW = Math.max(mobile ? 30 : 42, Math.round(cardH * 0.706));
    if (cardW > maxCardW) {
      cardW = maxCardW;
      cardH = Math.round(cardW / 0.706);
    }
    totalH = 2 * (playerInfoH + cardH + 4 * stackOffset) + cardH + 2 * centerPad + 2 * tableGap;
  }

  root.style.setProperty('--card-w', `${cardW}px`);
  root.style.setProperty('--card-h', `${cardH}px`);
  root.style.setProperty('--stack-offset', `${stackOffset}px`);
  root.style.setProperty('--col-gap', `${colGap}px`);
  root.style.setProperty('--zone-gap', `${zoneGap}px`);
  root.style.setProperty('--app-pad-x', mobile ? '2px' : '12px');
  root.style.setProperty('--app-pad-y', `${padY}px`);
  document.body.classList.toggle('is-mobile', mobile);
  document.body.classList.toggle('is-playing', !!playing);

  requestAnimationFrame(() => {
    const table = document.querySelector('.table');
    const app = document.getElementById('app');
    if (!table || !app) return;

    table.style.transform = '';
    table.style.width = '';
    table.style.height = '';
    table.style.margin = '';

    const chrome = (header?.offsetHeight || 0) + (msg?.offsetHeight || 0)
      + ((mobile && playing) ? 0 : (footer?.offsetHeight || 0));
    const avail = app.clientHeight - chrome - padY;
    const needed = table.scrollHeight;

    if (needed > avail + 1) {
      const scale = Math.max(0.72, avail / needed);
      table.style.transform = `scale(${scale})`;
      table.style.transformOrigin = 'center center';
      table.style.width = `${100 / scale}%`;
      table.style.height = `${avail / scale}px`;
      table.style.margin = '0 auto';
    }
  });
}

function scheduleLayoutUpdate() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    updateViewportLayout();
    if (gameState) scheduleRender();
  }, 50);
}

window.addEventListener('resize', scheduleLayoutUpdate);
window.addEventListener('orientationchange', scheduleLayoutUpdate);
updateViewportLayout();

const net = {
  mode: 'solo', // 'solo' | 'host' | 'guest'
  peer: null,
  conn: null,
  code: null,
  connected: false,
};

// --- Utilitaires cartes ---

function createDeck() {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: id++, suit, rank });
    }
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rankLabel(rank) {
  return RANKS[rank - 1];
}

function isRed(card) {
  return RED_SUITS.has(card.suit);
}

function isFaceCard(rank) {
  return rank >= 11;
}

function isConsecutive(rankA, rankB) {
  if (Math.abs(rankA - rankB) === 1) return true;
  if ((rankA === 1 && rankB === 13) || (rankA === 13 && rankB === 1)) return true;
  return false;
}

function canPlayOn(card, pileTop) {
  if (!pileTop) return false;
  return isConsecutive(card.rank, pileTop.rank);
}

/**
 * Disposition exacte des symboles comme sur un vrai jeu de cartes.
 * x, y en % de la zone centrale ; inv = symbole retourné (moitié basse).
 * Colonnes latérales : x = 25 / 75. Rangées : 15, 38.3, 50, 61.7, 85.
 */
const PIP_LAYOUTS = {
  1: [{ x: 50, y: 50, large: true }],
  2: [
    { x: 50, y: 15 },
    { x: 50, y: 85, inv: true },
  ],
  3: [
    { x: 50, y: 15 },
    { x: 50, y: 50 },
    { x: 50, y: 85, inv: true },
  ],
  4: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
  5: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 50, y: 50 },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
  6: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 25, y: 50 }, { x: 75, y: 50 },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
  7: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 50, y: 32.5 },
    { x: 25, y: 50 }, { x: 75, y: 50 },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
  8: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 50, y: 32.5 },
    { x: 25, y: 50 }, { x: 75, y: 50 },
    { x: 50, y: 67.5, inv: true },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
  9: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 25, y: 38.3 }, { x: 75, y: 38.3 },
    { x: 50, y: 50 },
    { x: 25, y: 61.7, inv: true }, { x: 75, y: 61.7, inv: true },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
  10: [
    { x: 25, y: 15 }, { x: 75, y: 15 },
    { x: 50, y: 26.7 },
    { x: 25, y: 38.3 }, { x: 75, y: 38.3 },
    { x: 25, y: 61.7, inv: true }, { x: 75, y: 61.7, inv: true },
    { x: 50, y: 73.3, inv: true },
    { x: 25, y: 85, inv: true }, { x: 75, y: 85, inv: true },
  ],
};

// --- État du jeu ---

function createPlayer() {
  return {
    columns: [[], [], [], [], []],
    stock: [],
    roundsWon: 0,
    emptiedFirst: false,
  };
}

function setupColumns(cards) {
  const columns = [[], [], [], [], []];
  let idx = 0;

  if (cards.length <= 5) {
    // Peu de cartes : une par emplacement pour rester jouable.
    while (idx < cards.length) {
      const card = cards[idx];
      card.faceUp = true;
      columns[idx].push(card);
      idx++;
    }
  } else {
    for (let col = 0; col < 5 && idx < cards.length; col++) {
      const count = Math.min(col + 1, cards.length - idx);
      for (let i = 0; i < count; i++) {
        const card = cards[idx++];
        card.faceUp = i === count - 1;
        columns[col].push(card);
      }
    }
  }

  return { columns, stock: cards.slice(idx) };
}

function initGame() {
  const deck = shuffle(createDeck());
  const playerCards = deck.slice(0, 26);
  const opponentCards = deck.slice(26);

  const playerSetup = setupColumns(playerCards);
  const opponentSetup = setupColumns(opponentCards);

  gameState = {
    phase: 'countdown',
    player: { ...createPlayer(), columns: playerSetup.columns, stock: playerSetup.stock },
    opponent: { ...createPlayer(), columns: opponentSetup.columns, stock: opponentSetup.stock },
    centerPiles: [[], []],
    roundWinner: null,
    gameWinner: null,
    countdown: 3,
  };

  clearAiTimeout();
  clearFlipCountdown();
  endDrag();
  pendingRender = false;
  lastRevealedId = null;
  scheduleRender();
  startCountdown();
}

function startCountdown() {
  const el = document.getElementById('countdown');
  el.classList.remove('hidden');

  function tick() {
    if (!gameState) return;
    if (gameState.countdown > 0) {
      const text = String(gameState.countdown);
      el.textContent = text;
      sendNet({ type: 'countdown', value: text });
      gameState.countdown--;
      setTimeout(tick, 700);
    } else {
      el.textContent = 'Go !';
      sendNet({ type: 'countdown', value: 'Go !' });
      flipInitialStockCards();
      gameState.phase = 'playing';
      setStatus('Glissez-déposez vos cartes vers les piles centrales !');
      scheduleRender();
      scheduleAiTurn();
      setTimeout(() => {
        if (!gameState || (gameState.phase !== 'countdown' && gameState.phase !== 'stockCountdown')) {
          el.classList.add('hidden');
        }
      }, 600);
    }
  }
  tick();
}

function flipInitialStockCards() {
  flipStockCard('player', 0);
  flipStockCard('opponent', 1);
}

function flipStockCard(who, pileIndex) {
  const p = gameState[who];
  if (p.stock.length === 0) return false;
  const card = p.stock.pop();
  card.faceUp = true;
  gameState.centerPiles[pileIndex].push(card);
  return true;
}

// --- Actions de jeu ---

function getPlayableCards(who) {
  const p = gameState[who];
  const cards = [];
  p.columns.forEach((col, colIndex) => {
    if (col.length > 0) {
      const top = col[col.length - 1];
      if (top.faceUp) {
        cards.push({ card: top, colIndex, who });
      }
    }
  });
  return cards;
}

function getValidPiles(card) {
  const valid = [];
  gameState.centerPiles.forEach((pile, index) => {
    const top = pile[pile.length - 1];
    if (top && canPlayOn(card, top)) {
      valid.push(index);
    }
  });
  return valid;
}

function getEmptyColumnIndices(who, excludeColIndex = -1) {
  return gameState[who].columns
    .map((col, i) => (col.length === 0 && i !== excludeColIndex ? i : -1))
    .filter(i => i >= 0);
}

/** Colonnes vides où l'on peut déposer pour retourner une carte cachée (retrouver 5 visibles). */
function getFillTargetsForColumn(who, fromColIndex) {
  const fromCol = gameState[who].columns[fromColIndex];
  if (!fromCol || fromCol.length <= 1) return [];
  return getEmptyColumnIndices(who, fromColIndex);
}

function countVisibleColumns(who) {
  return gameState[who].columns.filter(col => col.length > 0).length;
}

function canPlayOnCenter(who) {
  return getPlayableCards(who).some(p => getValidPiles(p.card).length > 0);
}

function isGameBlockedForStock() {
  return !canPlayOnCenter('player') && !canPlayOnCenter('opponent');
}

function canFlipStocks() {
  if (!gameState || gameState.phase !== 'playing') return false;
  if (!isGameBlockedForStock()) return false;
  return gameState.player.stock.length > 0 || gameState.opponent.stock.length > 0;
}

function flipBothStocks() {
  if (!canFlipStocks()) return false;

  const playerStockEl = document.querySelector('#player-stock .card');
  const opponentStockEl = document.querySelector('#opponent-stock .card');

  let flipped = false;
  if (gameState.player.stock.length > 0) {
    const cardId = gameState.player.stock[gameState.player.stock.length - 1].id;
    flipStockCard('player', 0);
    queueFlyAnim(cardId, playerStockEl);
    flipped = true;
  }
  if (gameState.opponent.stock.length > 0) {
    const cardId = gameState.opponent.stock[gameState.opponent.stock.length - 1].id;
    flipStockCard('opponent', 1);
    queueFlyAnim(cardId, opponentStockEl);
    flipped = true;
  }

  if (flipped) {
    showMessage('');
    scheduleRender();
    scheduleAiTurn();
  }
  return flipped;
}

function clearFlipCountdown() {
  if (flipCountdownTimer) {
    clearTimeout(flipCountdownTimer);
    flipCountdownTimer = null;
  }
}

function cancelStockFlipCountdown(message) {
  clearFlipCountdown();
  if (!gameState || gameState.phase !== 'stockCountdown') return;

  gameState.phase = 'playing';
  document.getElementById('countdown').classList.add('hidden');
  if (message) showMessage(message, true);
  scheduleRender();
}

function runFlipCountdown(onComplete) {
  if (!gameState) return;

  clearFlipCountdown();
  endDrag();

  if (!canFlipStocks()) {
    showMessage('Pioche possible seulement quand aucun joueur ne peut jouer.', true);
    return;
  }

  const el = document.getElementById('countdown');
  el.classList.remove('hidden');
  let count = 3;
  gameState.phase = 'stockCountdown';
  scheduleRender();

  function tick() {
    if (!gameState || gameState.phase !== 'stockCountdown') return;

    if (!isGameBlockedForStock()) {
      cancelStockFlipCountdown('Pioche annulée : un joueur peut encore jouer.');
      return;
    }

    if (count > 0) {
      const text = String(count);
      el.textContent = text;
      sendNet({ type: 'stockCountdown', value: text });
      count -= 1;
      flipCountdownTimer = setTimeout(tick, 700);
      return;
    }

    gameState.phase = 'playing';
    flipCountdownTimer = null;

    if (!canFlipStocks()) {
      el.classList.add('hidden');
      showMessage('Pioche annulée : un joueur peut encore jouer.', true);
      scheduleRender();
      return;
    }

    el.textContent = 'Go !';
    sendNet({ type: 'stockCountdown', value: 'Go !' });
    onComplete();
    setTimeout(() => {
      if (!gameState || (gameState.phase !== 'countdown' && gameState.phase !== 'stockCountdown')) {
        el.classList.add('hidden');
      }
    }, 600);
  }

  tick();
}

function requestStockFlip() {
  if (!canFlipStocks()) {
    showMessage('Pioche possible seulement quand aucun joueur ne peut jouer.', true);
    return;
  }

  runFlipCountdown(() => {
    if (canFlipStocks()) {
      flipBothStocks();
    }
  });
}

function moveCardToEmptyColumn(who, fromColIndex, toColIndex) {
  if (gameState.phase === 'stockCountdown') {
    cancelStockFlipCountdown();
  }

  const p = gameState[who];
  const fromCol = p.columns[fromColIndex];
  const toCol = p.columns[toColIndex];

  if (!fromCol || fromCol.length <= 1 || !toCol || toCol.length !== 0) return false;
  if (fromColIndex === toColIndex) return false;
  if (!fromCol[fromCol.length - 1].faceUp) return false;

  const card = fromCol.pop();
  if (fromCol.length > 0) {
    fromCol[fromCol.length - 1].faceUp = true;
    lastRevealedId = fromCol[fromCol.length - 1].id;
  }

  card.faceUp = true;
  toCol.push(card);
  checkColumnsEmpty(who);
  scheduleRender();
  scheduleAiTurn();
  return true;
}

function cleanupTransientCards() {
  if (dragState) return;
  document.querySelectorAll('.card-flyer, .drag-floating, .drag-placeholder').forEach(el => el.remove());
}

function endDrag() {
  if (!dragState) return;

  const state = dragState;
  dragState = null;

  if (state.rafId) cancelAnimationFrame(state.rafId);

  if (state.cardEl) {
    state.cardEl.classList.remove('drag-floating', 'dragging');
    state.cardEl.style.cssText = '';
    if (state.cardEl.isConnected) state.cardEl.remove();
  }

  if (state.sourceEl && state.sourceEl !== state.cardEl) {
    state.sourceEl.classList.remove('dragging');
    state.sourceEl.style.visibility = '';
    try { state.sourceEl.releasePointerCapture(state.pointerId); } catch (err) { /* ok */ }
  }

  try {
    if (state.cardEl) state.cardEl.releasePointerCapture(state.pointerId);
  } catch (err) { /* ok */ }

  if (state.onMove && state.sourceEl) {
    state.sourceEl.removeEventListener('pointermove', state.onMove);
    state.sourceEl.removeEventListener('pointerup', state.onEnd);
    state.sourceEl.removeEventListener('pointercancel', state.onEnd);
  }

  document.removeEventListener('pointermove', state.onDocMove);
  document.removeEventListener('pointerup', state.onDocEnd);
  document.removeEventListener('pointercancel', state.onDocEnd);
  clearDropHighlights();
  clearColumnDropHighlights();
}

/** Mémorise la position de départ d'une carte pour l'animer après le rendu. */
function queueFlyAnim(cardId, sourceEl) {
  if (!sourceEl) return;
  const r = sourceEl.getBoundingClientRect();
  pendingFlyAnims.push({ cardId, left: r.left, top: r.top });
}

function runPendingFlyAnims() {
  if (!pendingFlyAnims.length) return;
  const anims = pendingFlyAnims;
  pendingFlyAnims = [];

  anims.forEach(({ cardId, left, top }) => {
    const el = document.querySelector(`.center-pile .card[data-card-id="${cardId}"]`);
    if (!el) return;
    const to = el.getBoundingClientRect();
    const dx = left - to.left;
    const dy = top - to.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.zIndex = '600';
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.3s cubic-bezier(0.22, 0.85, 0.28, 1)';
      el.style.transform = '';
      setTimeout(() => {
        el.style.zIndex = '';
        el.style.transition = '';
      }, 340);
    });
  });
}

function playCard(who, colIndex, pileIndex, options = {}) {
  if (gameState.phase === 'stockCountdown') {
    cancelStockFlipCountdown();
  }

  const p = gameState[who];
  const col = p.columns[colIndex];
  if (col.length === 0) return false;

  if (who === 'opponent') {
    const srcEl = document.querySelector(
      `#opponent-columns .column[data-col-index="${colIndex}"] .card:last-child`
    );
    queueFlyAnim(col[col.length - 1].id, srcEl);
  }

  const card = col.pop();
  if (col.length > 0) {
    col[col.length - 1].faceUp = true;
    lastRevealedId = col[col.length - 1].id;
  }

  card.faceUp = true;
  gameState.centerPiles[pileIndex].push(card);

  checkColumnsEmpty(who);

  if (!options.deferRender) {
    scheduleRender();
  }

  if (!options.skipAiSchedule) {
    scheduleAiTurn();
  }
  return true;
}

function checkColumnsEmpty(who) {
  const p = gameState[who];
  const allEmpty = p.columns.every(col => col.length === 0);

  if (allEmpty && !p.emptiedFirst) {
    p.emptiedFirst = true;

    if (who === 'player') {
      showMessage('Vous avez vidé vos colonnes ! Criez CRAPETTE !');
    } else {
      showMessage('L\'adversaire a vidé ses colonnes !', true);
      if (net.mode === 'solo') {
        setTimeout(() => aiCallCrapette(), 2000 + Math.random() * 2000);
      }
    }
  }
}

function getSmallerPileIndex() {
  return gameState.centerPiles[0].length <= gameState.centerPiles[1].length ? 0 : 1;
}

function callCrapette(who) {
  if (!gameState || gameState.phase !== 'playing') return;

  if (!gameState[who].emptiedFirst) {
    const other = who === 'player' ? 'opponent' : 'player';
    if (who === 'player') {
      showMessage(
        gameState[other].emptiedFirst
          ? 'Trop tard ! L\'adversaire a déjà vidé ses colonnes.'
          : 'Vous devez d\'abord vider vos 5 colonnes !',
        true
      );
    }
    return;
  }

  gameState.phase = 'roundEnd';
  clearAiTimeout();
  document.getElementById('btn-crapette').classList.add('hidden');

  const smallerIdx = getSmallerPileIndex();
  const winner = who;
  const loser = who === 'player' ? 'opponent' : 'player';
  gameState.roundWinner = winner;

  const smallerPile = [...gameState.centerPiles[smallerIdx]];
  const largerPile = [...gameState.centerPiles[1 - smallerIdx]];
  const smallerCount = smallerPile.length;

  // Le perdant récupère aussi les cartes restées dans ses colonnes.
  const loserColumnCards = gameState[loser].columns.flat();
  const winnerTotal = [...smallerPile, ...gameState[winner].stock];
  const loserTotal = [...largerPile, ...loserColumnCards, ...gameState[loser].stock];

  if (gameState[winner].stock.length === 0) {
    endGame(winner);
    return;
  }

  gameState[winner].roundsWon++;
  updateScores();

  const playerCards = winner === 'player' ? winnerTotal : loserTotal;
  const opponentCards = winner === 'player' ? loserTotal : winnerTotal;

  sendNet({
    type: 'roundEnd',
    youWin: winner === 'opponent',
    smallCount: smallerCount,
    winTotal: winnerTotal.length,
    loseTotal: loserTotal.length,
  });

  showRoundDialog(winner, smallerCount, winnerTotal.length, loserTotal.length, () => {
    startNextRound(playerCards, opponentCards);
  });
}

function aiCallCrapette() {
  if (gameState && gameState.phase === 'playing' && gameState.opponent.emptiedFirst) {
    callCrapette('opponent');
  }
}

function showRoundDialog(winner, smallCount, winTotal, loseTotal, onNext) {
  const dialog = document.getElementById('round-dialog');
  const title = document.getElementById('round-title');
  const msg = document.getElementById('round-message');
  const btn = document.getElementById('btn-next-round');

  const name = winner === 'player' ? 'Vous gagnez' : 'L\'adversaire gagne';
  title.textContent = `${name} la manche !`;
  msg.textContent = `Le gagnant prend la pile la plus petite (${smallCount} cartes) et sa pioche : ${winTotal} cartes contre ${loseTotal}.`;

  btn.disabled = false;
  btn.textContent = 'Manche suivante';
  btn.onclick = () => {
    dialog.close();
    onNext();
  };
  dialog.showModal();
}

function startNextRound(playerCards, opponentCards) {
  const pCards = shuffle(playerCards.map(c => ({ ...c, faceUp: false })));
  const oCards = shuffle(opponentCards.map(c => ({ ...c, faceUp: false })));

  if (pCards.length === 0) {
    endGame('opponent');
    return;
  }
  if (oCards.length === 0) {
    endGame('player');
    return;
  }

  const playerSetup = setupColumns(pCards);
  const opponentSetup = setupColumns(oCards);

  gameState.player.columns = playerSetup.columns;
  gameState.player.stock = playerSetup.stock;
  gameState.player.emptiedFirst = false;

  gameState.opponent.columns = opponentSetup.columns;
  gameState.opponent.stock = opponentSetup.stock;
  gameState.opponent.emptiedFirst = false;

  gameState.centerPiles = [[], []];
  gameState.phase = 'countdown';
  gameState.countdown = 3;
  gameState.roundWinner = null;
  lastRevealedId = null;

  scheduleRender();
  updateScores();
  startCountdown();
}

function endGame(winner) {
  gameState.phase = 'gameEnd';
  gameState.gameWinner = winner;
  gameState[winner].roundsWon++;

  sendNet({ type: 'gameEnd', youWin: winner === 'opponent' });

  if (winner === 'player') {
    showMessage('Victoire ! Vous avez gagné la partie !');
    setStatus('Félicitations ! Cliquez sur « Nouvelle partie » pour rejouer.');
  } else {
    showMessage('L\'adversaire remporte la partie.', true);
    setStatus('Dommage ! Réessayez une nouvelle partie.');
  }

  updateScores();
  scheduleRender();
}

// --- IA (mode solo) ---

function clearAiTimeout() {
  if (aiTimeout) {
    clearTimeout(aiTimeout);
    aiTimeout = null;
  }
}

function scheduleAiTurn() {
  if (net.mode !== 'solo') return;
  clearAiTimeout();
  if (!gameState || gameState.phase !== 'playing') return;

  aiTimeout = setTimeout(() => {
    aiPlay();
  }, AI_DELAY_MIN + Math.random() * (AI_DELAY_MAX - AI_DELAY_MIN));
}

function aiPlay() {
  if (!gameState || gameState.phase !== 'playing' || dragState) return;

  const playable = getPlayableCards('opponent');
  const moves = [];

  for (const { card, colIndex } of playable) {
    const validPiles = getValidPiles(card);
    for (const pileIndex of validPiles) {
      moves.push({ colIndex, pileIndex, priority: gameState.opponent.columns[colIndex].length });
    }
  }

  if (moves.length > 0) {
    moves.sort((a, b) => b.priority - a.priority);
    const move = moves[Math.floor(Math.random() * Math.min(3, moves.length))];
    playCard('opponent', move.colIndex, move.pileIndex);
    return;
  }

  if (canFlipStocks()) {
    aiTimeout = setTimeout(() => {
      if (!gameState || gameState.phase !== 'playing') return;
      requestStockFlip();
    }, AI_MOVE_PAUSE);
    return;
  }

  const emptyCols = getEmptyColumnIndices('opponent');
  if (emptyCols.length > 0) {
    const candidates = playable
      .filter(p => getFillTargetsForColumn('opponent', p.colIndex).length > 0)
      .sort((a, b) => gameState.opponent.columns[b.colIndex].length - gameState.opponent.columns[a.colIndex].length);

    if (candidates.length > 0) {
      const fromColIndex = candidates[0].colIndex;
      const toColIndex = getFillTargetsForColumn('opponent', fromColIndex)[0];
      moveCardToEmptyColumn('opponent', fromColIndex, toColIndex);
      return;
    }
  }

  scheduleAiTurn();
}

// --- Réseau (PeerJS) ---

function sendNet(msg) {
  if (net.mode === 'host' && net.connected && net.conn) {
    try { net.conn.send(msg); } catch (e) { /* connexion perdue */ }
  }
}

function sendToHost(msg) {
  if (net.mode === 'guest' && net.connected && net.conn) {
    try { net.conn.send(msg); } catch (e) { /* connexion perdue */ }
  }
}

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function resetNet() {
  if (net.peer) {
    try { net.peer.destroy(); } catch (e) { /* déjà fermé */ }
  }
  net.peer = null;
  net.conn = null;
  net.code = null;
  net.connected = false;
  net.mode = 'solo';
}

function setOnlineStatus(text, isError = false) {
  const el = document.getElementById('online-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function hostGame() {
  if (typeof Peer === 'undefined') {
    setOnlineStatus('Module réseau indisponible (connexion Internet requise).', true);
    return;
  }
  resetNet();
  net.mode = 'host';
  net.code = generateCode();
  setOnlineStatus('Création de la partie…');

  net.peer = new Peer('crapette-' + net.code);

  net.peer.on('open', () => {
    document.getElementById('room-code').textContent = net.code;
    document.getElementById('room-code-display').classList.remove('hidden');
    setOnlineStatus('En attente d\'un adversaire…');
  });

  net.peer.on('connection', (conn) => {
    if (net.conn) {
      conn.close();
      return;
    }
    net.conn = conn;
    conn.on('open', () => {
      net.connected = true;
      document.getElementById('online-dialog').close();
      document.getElementById('opponent-name').textContent = 'Adversaire (en ligne)';
      showMessage('Adversaire connecté ! La partie commence.');
      initGame();
    });
    conn.on('data', handleHostData);
    conn.on('close', onPeerDisconnect);
  });

  net.peer.on('error', (e) => {
    setOnlineStatus(`Erreur réseau : ${e.type}`, true);
  });
}

function joinGame(code) {
  if (typeof Peer === 'undefined') {
    setOnlineStatus('Module réseau indisponible (connexion Internet requise).', true);
    return;
  }
  if (!code || code.length < 4) {
    setOnlineStatus('Entrez le code à 4 caractères de la partie.', true);
    return;
  }
  resetNet();
  net.mode = 'guest';
  setOnlineStatus('Connexion à la partie…');

  net.peer = new Peer();

  net.peer.on('open', () => {
    const conn = net.peer.connect('crapette-' + code.toUpperCase(), { reliable: true });
    net.conn = conn;

    conn.on('open', () => {
      net.connected = true;
      document.getElementById('online-dialog').close();
      document.getElementById('opponent-name').textContent = 'Adversaire (hôte)';
      showMessage('Connecté ! La partie va commencer.');
      setStatus('Partie en ligne — l\'hôte contrôle le déroulement.');
    });
    conn.on('data', handleGuestData);
    conn.on('close', onPeerDisconnect);
  });

  net.peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      setOnlineStatus('Aucune partie trouvée avec ce code.', true);
    } else {
      setOnlineStatus(`Erreur réseau : ${e.type}`, true);
    }
  });
}

function onPeerDisconnect() {
  if (!net.connected) return;
  resetNet();
  showMessage('L\'adversaire s\'est déconnecté.', true);
  setStatus('Partie en ligne terminée. Lancez une nouvelle partie.');
  if (gameState) {
    gameState.phase = 'gameEnd';
    clearAiTimeout();
    scheduleRender();
  }
  document.getElementById('opponent-name').textContent = 'Adversaire';
}

/** L'hôte est autoritaire : il valide les actions de l'invité. */
function handleHostData(msg) {
  if (!gameState) return;

  switch (msg.type) {
    case 'move': {
      if (gameState.phase !== 'playing') return;
      const col = gameState.opponent.columns[msg.colIndex];
      if (!col || col.length === 0) return;
      const card = col[col.length - 1];
      if (!card.faceUp) return;
      const pileIndex = 1 - msg.pileIndex; // perspective inversée
      const top = gameState.centerPiles[pileIndex][gameState.centerPiles[pileIndex].length - 1];
      if (canPlayOn(card, top)) {
        playCard('opponent', msg.colIndex, pileIndex);
      }
      break;
    }
    case 'moveEmpty': {
      if (gameState.phase !== 'playing') return;
      const fromCol = gameState.opponent.columns[msg.fromColIndex];
      const toCol = gameState.opponent.columns[msg.toColIndex];
      if (!fromCol || fromCol.length <= 1 || !toCol || toCol.length !== 0) return;
      if (!fromCol[fromCol.length - 1].faceUp) return;
      moveCardToEmptyColumn('opponent', msg.fromColIndex, msg.toColIndex);
      break;
    }
    case 'flip': {
      if (gameState.phase !== 'playing') return;
      if (!canFlipStocks()) return;
      requestStockFlip();
      break;
    }
    case 'crapette': {
      callCrapette('opponent');
      break;
    }
  }
}

/** État envoyé à l'invité, avec les perspectives joueur/adversaire inversées. */
function serializeForGuest() {
  return {
    phase: gameState.phase,
    centerPiles: [gameState.centerPiles[1], gameState.centerPiles[0]],
    player: gameState.opponent,
    opponent: gameState.player,
  };
}

function applyGuestState(state) {
  gameState = {
    phase: state.phase,
    centerPiles: state.centerPiles,
    player: state.player,
    opponent: state.opponent,
    roundWinner: null,
    gameWinner: null,
    countdown: 0,
  };
  if (state.phase !== 'countdown' && state.phase !== 'stockCountdown') {
    document.getElementById('countdown').classList.add('hidden');
  }
  scheduleRender();
}

function handleGuestData(msg) {
  switch (msg.type) {
    case 'state': {
      if (dragState) {
        pendingGuestState = msg.state;
      } else {
        applyGuestState(msg.state);
      }
      break;
    }
    case 'stockCountdown': {
      const el = document.getElementById('countdown');
      el.classList.remove('hidden');
      el.textContent = msg.value;
      if (gameState) {
        gameState.phase = 'stockCountdown';
      }
      break;
    }
    case 'countdown': {
      const roundDialog = document.getElementById('round-dialog');
      if (roundDialog.open) roundDialog.close();
      const el = document.getElementById('countdown');
      el.classList.remove('hidden');
      el.textContent = msg.value;
      setStatus('Glissez-déposez vos cartes vers les piles centrales !');
      break;
    }
    case 'roundEnd': {
      const dialog = document.getElementById('round-dialog');
      const title = document.getElementById('round-title');
      const text = document.getElementById('round-message');
      const btn = document.getElementById('btn-next-round');

      title.textContent = msg.youWin ? 'Vous gagnez la manche !' : 'L\'adversaire gagne la manche !';
      const winTotal = msg.youWin ? msg.winTotal : msg.loseTotal;
      const loseTotal = msg.youWin ? msg.loseTotal : msg.winTotal;
      text.textContent = `Le gagnant prend la pile la plus petite (${msg.smallCount} cartes). Vous : ${winTotal} cartes, adversaire : ${loseTotal}.`;

      btn.disabled = true;
      btn.textContent = 'En attente de l\'hôte…';
      dialog.showModal();
      break;
    }
    case 'gameEnd': {
      const roundDialog = document.getElementById('round-dialog');
      if (roundDialog.open) roundDialog.close();
      if (msg.youWin) {
        showMessage('Victoire ! Vous avez gagné la partie !');
        setStatus('Félicitations !');
      } else {
        showMessage('L\'adversaire remporte la partie.', true);
        setStatus('Dommage !');
      }
      break;
    }
  }
}

// --- Rendu des cartes ---

function buildCardFace(card) {
  const face = document.createElement('div');
  face.className = 'card-face';

  const cornerTop = document.createElement('div');
  cornerTop.className = 'card-corner top';
  cornerTop.innerHTML = `<span class="corner-rank">${rankLabel(card.rank)}</span><span class="corner-suit">${card.suit}</span>`;

  const cornerBottom = document.createElement('div');
  cornerBottom.className = 'card-corner bottom';
  cornerBottom.innerHTML = `<span class="corner-rank">${rankLabel(card.rank)}</span><span class="corner-suit">${card.suit}</span>`;

  const body = document.createElement('div');
  body.className = 'card-body';

  if (isFaceCard(card.rank)) {
    body.classList.add('face-card');
    const frame = document.createElement('div');
    frame.className = 'face-frame';
    const letter = document.createElement('div');
    letter.className = 'face-letter';
    letter.textContent = rankLabel(card.rank);
    const suitBig = document.createElement('div');
    suitBig.className = 'face-suit';
    suitBig.textContent = card.suit;
    frame.appendChild(letter);
    frame.appendChild(suitBig);
    body.appendChild(frame);
  } else {
    const layout = PIP_LAYOUTS[card.rank];
    layout.forEach(pip => {
      const el = document.createElement('span');
      el.className = 'card-pip';
      if (pip.large) el.classList.add('large');
      if (pip.inv) el.classList.add('inverted');
      el.textContent = card.suit;
      el.style.left = `${pip.x}%`;
      el.style.top = `${pip.y}%`;
      body.appendChild(el);
    });
  }

  face.appendChild(cornerTop);
  face.appendChild(body);
  face.appendChild(cornerBottom);
  return face;
}

function createCardElement(card, options = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = card.id;

  if (!card.faceUp) {
    el.classList.add('face-down');
  } else {
    el.classList.add('face-up');
    el.classList.add(isRed(card) ? 'red' : 'black');
    el.appendChild(buildCardFace(card));
  }

  if (options.playable) {
    el.classList.add('playable', 'draggable');
  }
  if (options.revealed) {
    el.classList.add('card-flip-in');
  }
  if (options.landing) {
    el.classList.add('card-land');
  }
  if (options.cardIndex !== undefined) {
    el.style.setProperty('--card-index', options.cardIndex);
  }

  return el;
}

function scheduleRender() {
  if (dragState) {
    pendingRender = true;
    return;
  }
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

function debouncedSendState() {
  if (net.mode !== 'host' || !net.connected) return;
  clearTimeout(netSyncTimer);
  netSyncTimer = setTimeout(() => {
    if (gameState) {
      sendNet({ type: 'state', state: serializeForGuest() });
    }
  }, NET_SYNC_MS);
}

function renderColumns(container, columns, who) {
  container.innerHTML = '';

  // Mode « en main » : plus de pioche et au plus 5 cartes restantes.
  const totalCards = columns.reduce((n, col) => n + col.length, 0);
  const handMode = gameState[who].stock.length === 0 && totalCards > 0 && totalCards <= 5;
  container.classList.toggle('hand-mode', handMode);
  const visibleIdx = columns.map((c, i) => (c.length ? i : -1)).filter(i => i >= 0);
  container.style.setProperty('--hand-n', Math.max(1, visibleIdx.length));

  columns.forEach((col, colIndex) => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.colIndex = colIndex;
    columnEl.style.setProperty('--col-depth', Math.max(0, col.length - 1));
    if (handMode && col.length > 0) {
      columnEl.style.setProperty('--hand-i', visibleIdx.indexOf(colIndex));
    }

    if (col.length === 0) {
      columnEl.classList.add('column-empty');
      const dropZone = document.createElement('div');
      dropZone.className = 'column-drop-zone';
      dropZone.setAttribute('aria-label', 'Emplacement vide');
      columnEl.appendChild(dropZone);
    }

    col.forEach((card, i) => {
      const isTop = i === col.length - 1;
      const canInteract = isTop && card.faceUp && gameState.phase === 'playing' && who === 'player';
      const validPiles = canInteract ? getValidPiles(card) : [];
      const validEmptyCols = canInteract ? getFillTargetsForColumn('player', colIndex) : [];
      const playable = canInteract && (validPiles.length > 0 || validEmptyCols.length > 0);
      const revealed = card.id === lastRevealedId;

      // En main, l'adversaire cache ses cartes : on n'affiche que les dos.
      const displayCard = (handMode && who === 'opponent') ? { ...card, faceUp: false } : card;

      const cardEl = createCardElement(displayCard, {
        playable,
        revealed,
        cardIndex: i,
      });

      if (playable) {
        setupCardDrag(cardEl, colIndex, card);
      }

      columnEl.appendChild(cardEl);
    });

    container.appendChild(columnEl);
  });
}

function renderCenterPiles() {
  const container = document.getElementById('center-piles');
  container.innerHTML = '';

  gameState.centerPiles.forEach((pile, pileIndex) => {
    const pileEl = document.createElement('div');
    pileEl.className = 'pile center-pile';
    pileEl.dataset.pileIndex = pileIndex;

    if (pile.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'card face-down pile-placeholder';
      pileEl.appendChild(placeholder);
    } else {
      const top = pile[pile.length - 1];
      pileEl.appendChild(createCardElement(top, { cardIndex: 0 }));

      const count = document.createElement('span');
      count.className = 'pile-count';
      count.textContent = pile.length;
      pileEl.appendChild(count);
    }

    container.appendChild(pileEl);
  });
}

function renderStock(container, stock, who) {
  container.innerHTML = '';

  const pileEl = document.createElement('div');
  pileEl.className = 'pile stock-pile-inner';

  if (stock.length > 0) {
    pileEl.appendChild(createCardElement({ id: -1, faceUp: false }));

    const count = document.createElement('span');
    count.className = 'stock-count';
    count.textContent = stock.length;
    pileEl.appendChild(count);

    if (who === 'player' && gameState.phase === 'playing' && canFlipStocks()) {
      pileEl.classList.add('stock-clickable');
      pileEl.addEventListener('click', onStockClick);
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'stock-empty';
    empty.textContent = 'Vide';
    pileEl.appendChild(empty);
  }

  container.appendChild(pileEl);
}

function render() {
  if (!gameState) return;
  if (dragState) {
    pendingRender = true;
    return;
  }

  cleanupTransientCards();

  renderColumns(document.getElementById('player-columns'), gameState.player.columns, 'player');
  renderColumns(document.getElementById('opponent-columns'), gameState.opponent.columns, 'opponent');
  renderCenterPiles();
  renderStock(document.getElementById('player-stock'), gameState.player.stock, 'player');
  renderStock(document.getElementById('opponent-stock'), gameState.opponent.stock, 'opponent');
  updateScores();

  const showCrapette = gameState.phase === 'playing' &&
    gameState.player.columns.every(col => col.length === 0);
  document.getElementById('btn-crapette').classList.toggle('hidden', !showCrapette);

  lastRevealedId = null;
  debouncedSendState();
  runPendingFlyAnims();
  if (!dragState) updateViewportLayout();
}

function updateScores() {
  if (!gameState) return;
  document.getElementById('player-score').textContent = `${gameState.player.roundsWon} manche(s)`;
  document.getElementById('opponent-score').textContent = `${gameState.opponent.roundsWon} manche(s)`;
}

// --- Glisser-déposer ---

function setupCardDrag(cardEl, colIndex, card) {
  cardEl.addEventListener('pointerdown', (e) => {
    if (!gameState || gameState.phase !== 'playing' || e.button !== 0 || dragState) return;

    const validPiles = getValidPiles(card);
    const validEmptyCols = getFillTargetsForColumn('player', colIndex);
    if (validPiles.length === 0 && validEmptyCols.length === 0) {
      if (getEmptyColumnIndices('player').length > 0 && gameState.player.columns[colIndex].length <= 1) {
        showMessage('Choisissez une colonne qui cache encore des cartes pour remplir un emplacement vide.', true);
      } else {
        showMessage('Cette carte ne peut pas être jouée.', true);
      }
      return;
    }

    e.preventDefault();
    endDrag();

    const rect = cardEl.getBoundingClientRect();
    document.body.appendChild(cardEl);
    cardEl.classList.add('drag-floating');
    cardEl.style.position = 'fixed';
    cardEl.style.left = `${rect.left}px`;
    cardEl.style.top = `${rect.top}px`;
    cardEl.style.width = `${rect.width}px`;
    cardEl.style.height = `${rect.height}px`;
    cardEl.style.margin = '0';
    cardEl.style.zIndex = '10000';
    cardEl.style.transform = 'rotate(2deg)';
    cardEl.style.visibility = 'visible';

    try { cardEl.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }

    const updatePosition = () => {
      if (!dragState) return;
      dragState.cardEl.style.left = `${dragState.lastX - dragState.offsetX}px`;
      dragState.cardEl.style.top = `${dragState.lastY - dragState.offsetY}px`;
      dragState.rafId = null;
    };

    const onMove = (ev) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;
      dragState.lastX = ev.clientX;
      dragState.lastY = ev.clientY;
      if (!dragState.rafId) {
        dragState.rafId = requestAnimationFrame(updatePosition);
      }

      document.querySelectorAll('.center-pile').forEach(p => p.classList.remove('drop-hover'));
      document.querySelectorAll('#player-columns .column').forEach(c => c.classList.remove('drop-hover'));

      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const pile = target && target.closest('.center-pile');
      if (pile) {
        const idx = parseInt(pile.dataset.pileIndex, 10);
        if (dragState.validPiles.includes(idx)) {
          pile.classList.add('drop-hover');
        }
      }

      const column = target && target.closest('#player-columns .column');
      if (column) {
        const toColIndex = parseInt(column.dataset.colIndex, 10);
        if (dragState.validEmptyCols.includes(toColIndex)) {
          column.classList.add('drop-hover');
        }
      }
    };

    const finishPointer = (ev) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;

      const savedDrag = dragState;
      const dropX = ev.clientX;
      const dropY = ev.clientY;
      endDrag();

      let played = false;
      const target = document.elementFromPoint(dropX, dropY);
      const pile = target && target.closest('.center-pile');
      if (pile) {
        const pileIndex = parseInt(pile.dataset.pileIndex, 10);
        if (savedDrag.validPiles.includes(pileIndex)) {
          if (net.mode === 'guest') {
            sendToHost({ type: 'move', colIndex: savedDrag.colIndex, pileIndex });
          } else {
            playCard('player', savedDrag.colIndex, pileIndex);
          }
          played = true;
        }
      }

      if (!played) {
        const column = target && target.closest('#player-columns .column');
        if (column) {
          const toColIndex = parseInt(column.dataset.colIndex, 10);
          if (savedDrag.validEmptyCols.includes(toColIndex)) {
            if (net.mode === 'guest') {
              sendToHost({ type: 'moveEmpty', fromColIndex: savedDrag.colIndex, toColIndex });
            } else {
              moveCardToEmptyColumn('player', savedDrag.colIndex, toColIndex);
            }
            played = true;
          }
        }
      }

      if (played) {
        showMessage('');
        pendingGuestState = null;
        pendingRender = false;
      } else {
        if (pendingGuestState) {
          applyGuestState(pendingGuestState);
          pendingGuestState = null;
        } else {
          pendingRender = false;
          scheduleRender();
        }
      }
    };

    const onEnd = (ev) => finishPointer(ev);

    const onDocMove = (ev) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;
      onMove(ev);
    };

    const onDocEnd = (ev) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;
      finishPointer(ev);
    };

    dragState = {
      colIndex,
      card,
      validPiles,
      validEmptyCols,
      cardEl,
      sourceEl: cardEl,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pointerId: e.pointerId,
      rafId: null,
      lastX: e.clientX,
      lastY: e.clientY,
      onMove,
      onEnd,
      onDocMove,
      onDocEnd,
    };

    highlightDropZones(validPiles);
    highlightEmptyColumns(validEmptyCols);

    cardEl.addEventListener('pointermove', onMove);
    cardEl.addEventListener('pointerup', onEnd);
    cardEl.addEventListener('pointercancel', onEnd);
    document.addEventListener('pointermove', onDocMove);
    document.addEventListener('pointerup', onDocEnd);
    document.addEventListener('pointercancel', onDocEnd);
  });
}

function highlightDropZones(validPiles) {
  document.querySelectorAll('.center-pile').forEach(pile => {
    const idx = parseInt(pile.dataset.pileIndex, 10);
    if (validPiles.includes(idx)) {
      pile.classList.add('valid-target');
    } else {
      pile.classList.add('invalid-target');
    }
  });
}

function clearDropHighlights() {
  document.querySelectorAll('.center-pile').forEach(pile => {
    pile.classList.remove('valid-target', 'invalid-target', 'drop-hover');
  });
}

function highlightEmptyColumns(validEmptyCols) {
  document.querySelectorAll('#player-columns .column-empty').forEach(column => {
    const idx = parseInt(column.dataset.colIndex, 10);
    if (validEmptyCols.includes(idx)) {
      column.classList.add('valid-target');
    }
  });
}

function clearColumnDropHighlights() {
  document.querySelectorAll('#player-columns .column').forEach(column => {
    column.classList.remove('valid-target', 'drop-hover');
  });
}

// --- Interactions ---

function onStockClick() {
  if (!gameState || gameState.phase !== 'playing') return;

  if (net.mode === 'guest') {
    if (!canFlipStocks()) {
      showMessage('Pioche possible seulement quand aucun joueur ne peut jouer.', true);
      return;
    }
    sendToHost({ type: 'flip' });
    return;
  }

  requestStockFlip();
}

function showMessage(text, isError = false) {
  const bar = document.getElementById('message-bar');
  bar.textContent = text;
  bar.classList.toggle('error', isError);
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

// --- Event listeners ---

document.getElementById('btn-new-game').addEventListener('click', () => {
  if (net.mode === 'guest' && net.connected) {
    showMessage('Seul l\'hôte peut lancer une nouvelle partie.', true);
    return;
  }
  if (!net.connected) {
    resetNet();
    document.getElementById('opponent-name').textContent = 'Adversaire';
  }
  showMessage('');
  setStatus('La partie commence…');
  initGame();
});

document.getElementById('btn-crapette').addEventListener('click', () => {
  if (net.mode === 'guest') {
    sendToHost({ type: 'crapette' });
  } else {
    callCrapette('player');
  }
});

document.getElementById('btn-rules').addEventListener('click', () => {
  document.getElementById('rules-dialog').showModal();
});

document.getElementById('btn-close-rules').addEventListener('click', () => {
  document.getElementById('rules-dialog').close();
});

document.getElementById('btn-online').addEventListener('click', () => {
  setOnlineStatus('');
  document.getElementById('online-dialog').showModal();
});

document.getElementById('btn-close-online').addEventListener('click', () => {
  document.getElementById('online-dialog').close();
});

document.getElementById('btn-create-room').addEventListener('click', hostGame);

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim();
  joinGame(code);
});

document.getElementById('join-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    joinGame(e.target.value.trim());
  }
});

document.getElementById('join-code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
