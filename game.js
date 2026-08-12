/**
 * Crapette Rapide - Jeu de cartes à 2 joueurs
 * Modes : solo (contre l'ordinateur) et en ligne (PeerJS, code de partie)
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const RED_SUITS = new Set(['♥', '♦']);

const AI_DELAY_MIN = 2200;
const AI_DELAY_MAX = 4500;
const AI_MOVE_PAUSE = 1200;
const ANIM_PLAY_MS = 240;
const NET_SYNC_MS = 80;

function updateViewportLayout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw <= 768;
  const root = document.documentElement;

  const padY = mobile ? 6 : 12;
  const headerH = mobile ? 42 : 58;
  const msgH = mobile ? 20 : 28;
  const footerH = mobile ? 18 : 30;
  const playerInfoH = mobile ? 16 : 22;
  const centerPad = mobile ? 10 : 18;

  const availableH = vh - headerH - msgH - footerH - padY * 2;
  const stackOffset = mobile ? 8 : (vw < 1024 ? 14 : 20);

  const centerExtra = mobile ? 8 : 16;
  const zoneForColumns = (availableH - centerPad * 2 - centerExtra - playerInfoH * 2) / 2;
  let cardH = Math.floor(zoneForColumns - (4 * stackOffset));
  cardH = Math.max(mobile ? 58 : 88, Math.min(cardH, mobile ? 78 : 128));

  const colGap = mobile ? 3 : 8;
  const zoneGap = mobile ? 4 : 18;
  const usableW = vw - (mobile ? 8 : 24);
  const maxCardW = Math.floor((usableW - zoneGap - colGap * 4) / 6);

  let cardW = Math.round(cardH * 0.706);
  if (cardW > maxCardW) {
    cardW = maxCardW;
    cardH = Math.round(cardW / 0.706);
  }

  cardW = Math.max(mobile ? 40 : 58, cardW);
  cardH = Math.max(mobile ? 56 : 82, cardH);

  root.style.setProperty('--card-w', `${cardW}px`);
  root.style.setProperty('--card-h', `${cardH}px`);
  root.style.setProperty('--stack-offset', `${stackOffset}px`);
  root.style.setProperty('--col-gap', `${colGap}px`);
  root.style.setProperty('--zone-gap', `${zoneGap}px`);
  root.style.setProperty('--app-pad-x', mobile ? '4px' : '16px');
  root.style.setProperty('--app-pad-y', `${padY}px`);
  document.body.classList.toggle('is-mobile', mobile);
}

let layoutTimer = null;
function scheduleLayoutUpdate() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    updateViewportLayout();
    if (gameState) scheduleRender();
  }, 80);
}

window.addEventListener('resize', scheduleLayoutUpdate);
window.addEventListener('orientationchange', scheduleLayoutUpdate);
updateViewportLayout();

let gameState = null;
let aiTimeout = null;
let dragState = null;
let pendingGuestState = null;
let renderPending = false;
let netSyncTimer = null;
let lastRevealedId = null;
let animating = false;

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
  for (let col = 0; col < 5; col++) {
    const count = col + 1;
    for (let i = 0; i < count; i++) {
      const card = cards[idx++];
      card.faceUp = i === count - 1;
      columns[col].push(card);
    }
  }
  return { columns, stock: cards.slice(15) };
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
      const text = gameState.countdown === 1 ? 'Go !' : String(gameState.countdown);
      el.textContent = text;
      sendNet({ type: 'countdown', value: text });
      gameState.countdown--;
      setTimeout(tick, 700);
    } else {
      el.classList.add('hidden');
      flipInitialStockCards();
      gameState.phase = 'playing';
      setStatus('Glissez-déposez vos cartes vers les piles centrales !');
      scheduleRender();
      scheduleAiTurn();
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

function playCard(who, colIndex, pileIndex, options = {}) {
  const p = gameState[who];
  const col = p.columns[colIndex];
  if (col.length === 0) return false;

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

async function playCardAnimated(who, colIndex, pileIndex) {
  if (!gameState || gameState.phase !== 'playing' || animating) return false;

  const colSelector = who === 'player' ? 'player-columns' : 'opponent-columns';
  const columnEl = document.querySelector(`#${colSelector} .column[data-col-index="${colIndex}"]`);
  const pileEl = document.querySelector(`.center-pile[data-pile-index="${pileIndex}"]`);
  const col = gameState[who].columns[colIndex];

  if (!columnEl || !pileEl || !col.length) {
    return playCard(who, colIndex, pileIndex);
  }

  const sourceCardEl = columnEl.querySelector('.card.face-up:last-of-type') || columnEl.lastElementChild;
  const card = col[col.length - 1];
  const from = sourceCardEl.getBoundingClientRect();
  const to = pileEl.getBoundingClientRect();

  animating = true;
  if (sourceCardEl) {
    sourceCardEl.classList.add('card-leaving');
  }

  await flyCard(card, from, to);
  playCard(who, colIndex, pileIndex, { deferRender: true, skipAiSchedule: true });
  animating = false;
  scheduleRender();
  if (who === 'player') {
    scheduleAiTurn();
  }
  return true;
}

function flyCard(card, fromRect, toRect) {
  const flyer = createCardElement(card);
  flyer.classList.add('card-flyer');
  flyer.style.width = `${fromRect.width}px`;
  flyer.style.height = `${fromRect.height}px`;
  flyer.style.left = `${fromRect.left}px`;
  flyer.style.top = `${fromRect.top}px`;
  document.body.appendChild(flyer);

  const dx = toRect.left + toRect.width / 2 - fromRect.left - fromRect.width / 2;
  const dy = toRect.top + toRect.height / 2 - fromRect.top - fromRect.height / 2;

  return flyer.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.04)`, opacity: 1, offset: 0.82 },
    { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
  ], {
    duration: ANIM_PLAY_MS,
    easing: 'cubic-bezier(0.22, 0.85, 0.28, 1)',
    fill: 'forwards',
  }).finished.then(() => {
    flyer.remove();
  });
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

  const winnerTotal = [...smallerPile, ...gameState[winner].stock];
  const loserTotal = [...largerPile, ...gameState[loser].stock];

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

  const playerSetup = setupColumns(pCards.length >= 15 ? pCards : [...pCards, ...oCards].slice(0, 26));
  const opponentSetup = setupColumns(oCards.length >= 15 ? oCards : [...oCards, ...pCards].slice(0, 26));

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
  if (!gameState || gameState.phase !== 'playing' || animating) return;

  aiTimeout = setTimeout(() => {
    aiPlay();
  }, AI_DELAY_MIN + Math.random() * (AI_DELAY_MAX - AI_DELAY_MIN));
}

function aiPlay() {
  if (!gameState || gameState.phase !== 'playing' || animating) return;

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
    playCardAnimated('opponent', move.colIndex, move.pileIndex).then(() => {
      if (gameState && gameState.phase === 'playing') {
        scheduleAiTurn();
      }
    });
    return;
  }

  if (gameState.opponent.stock.length > 0) {
    aiTimeout = setTimeout(() => {
      if (!gameState || gameState.phase !== 'playing') return;
      flipStockCard('opponent', 1);
      scheduleRender();
      scheduleAiTurn();
    }, AI_MOVE_PAUSE);
    return;
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
        playCardAnimated('opponent', msg.colIndex, pileIndex);
      }
      break;
    }
    case 'flip': {
      if (gameState.phase !== 'playing') return;
      if (flipStockCard('opponent', 1)) {
        scheduleRender();
      }
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
  if (state.phase !== 'countdown') {
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

  columns.forEach((col, colIndex) => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.colIndex = colIndex;
    columnEl.style.setProperty('--col-depth', Math.max(0, col.length - 1));

    col.forEach((card, i) => {
      const isTop = i === col.length - 1;
      const playable = isTop && card.faceUp && gameState.phase === 'playing' && who === 'player';
      const revealed = card.id === lastRevealedId;

      const cardEl = createCardElement(card, {
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
      pileEl.appendChild(createCardElement(top, { cardIndex: 0, landing: true }));

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

    if (who === 'player' && gameState.phase === 'playing') {
      const playable = getPlayableCards('player');
      const hasMoves = playable.some(p => getValidPiles(p.card).length > 0);

      if (!hasMoves) {
        pileEl.classList.add('can-flip');
        pileEl.addEventListener('click', onStockClick);
      }
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
}

function updateScores() {
  if (!gameState) return;
  document.getElementById('player-score').textContent = `${gameState.player.roundsWon} manche(s)`;
  document.getElementById('opponent-score').textContent = `${gameState.opponent.roundsWon} manche(s)`;
}

// --- Glisser-déposer ---

function setupCardDrag(cardEl, colIndex, card) {
  cardEl.addEventListener('pointerdown', (e) => {
    if (!gameState || gameState.phase !== 'playing' || e.button !== 0) return;

    const validPiles = getValidPiles(card);
    if (validPiles.length === 0) {
      showMessage('Cette carte ne peut pas être jouée.', true);
      return;
    }

    e.preventDefault();
    try { cardEl.setPointerCapture(e.pointerId); } catch (err) { /* pointeur synthétique */ }

    const rect = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('drag-floating');
    ghost.classList.remove('dragging');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);

    dragState = {
      colIndex,
      card,
      validPiles,
      ghost,
      startLeft: rect.left,
      startTop: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pointerId: e.pointerId,
      rafId: null,
      lastX: e.clientX,
      lastY: e.clientY,
    };

    cardEl.classList.add('dragging');
    highlightDropZones(validPiles);

    const updateGhost = () => {
      if (!dragState) return;
      const x = dragState.lastX - dragState.offsetX - dragState.startLeft;
      const y = dragState.lastY - dragState.offsetY - dragState.startTop;
      dragState.ghost.style.transform = `translate(${x}px, ${y}px) rotate(2deg)`;
      dragState.rafId = null;
    };

    const onMove = (ev) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;
      dragState.lastX = ev.clientX;
      dragState.lastY = ev.clientY;
      if (!dragState.rafId) {
        dragState.rafId = requestAnimationFrame(updateGhost);
      }

      document.querySelectorAll('.center-pile').forEach(p => p.classList.remove('drop-hover'));
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const pile = target && target.closest('.center-pile');
      if (pile) {
        const idx = parseInt(pile.dataset.pileIndex, 10);
        if (dragState.validPiles.includes(idx)) {
          pile.classList.add('drop-hover');
        }
      }
    };

    const onEnd = async (ev) => {
      if (!dragState || ev.pointerId !== dragState.pointerId) return;

      cardEl.removeEventListener('pointermove', onMove);
      cardEl.removeEventListener('pointerup', onEnd);
      cardEl.removeEventListener('pointercancel', onEnd);
      cardEl.classList.remove('dragging');
      if (dragState.rafId) cancelAnimationFrame(dragState.rafId);
      dragState.ghost.remove();

      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const pile = target && target.closest('.center-pile');
      const savedDrag = dragState;
      dragState = null;
      clearDropHighlights();

      if (pile) {
        const pileIndex = parseInt(pile.dataset.pileIndex, 10);
        if (savedDrag.validPiles.includes(pileIndex)) {
          if (net.mode === 'guest') {
            sendToHost({ type: 'move', colIndex: savedDrag.colIndex, pileIndex });
          } else {
            await playCardAnimated('player', savedDrag.colIndex, pileIndex);
          }
          showMessage('');
        }
      }

      if (pendingGuestState) {
        applyGuestState(pendingGuestState);
        pendingGuestState = null;
      }
    };

    cardEl.addEventListener('pointermove', onMove);
    cardEl.addEventListener('pointerup', onEnd);
    cardEl.addEventListener('pointercancel', onEnd);
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

// --- Interactions ---

function onStockClick() {
  if (!gameState || gameState.phase !== 'playing') return;

  if (net.mode === 'guest') {
    sendToHost({ type: 'flip' });
    return;
  }

  if (flipStockCard('player', 0)) {
    showMessage('Nouvelle carte retournée depuis la pioche.');
    scheduleRender();
    scheduleAiTurn();
  }
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
