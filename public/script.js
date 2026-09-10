// ==========================================
// ===== КОНСТАНТЫ =====
// ==========================================
const MAIN_LABELS = ['1', '2', '3', '4', '5', '6'];
const COMBO_LABELS = ['Пара', '2 пары', 'Сет', '3+2', 'Каре', 'Малый стрит', 'Большой стрит', 'Чёт', 'Нечет', 'Покер'];

// ==========================================
// ===== TELEGRAM =====
// ==========================================
let tgUser = { id: 0, name: 'Игрок' };
try {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        tgUser.id = tg.initDataUnsafe.user.id;
        tgUser.name = tg.initDataUnsafe.user.first_name || tg.initDataUnsafe.user.username || 'Игрок';
    }
} catch (e) {
    console.log('Not in Telegram');
}
document.getElementById('userName').textContent = tgUser.name;

// ==========================================
// ===== SOCKET =====
// ==========================================
const socket = io();

let currentRoom = null;         // данные комнаты с сервера
let myTelegramId = tgUser.id;
let localMode = false;          // true = локальная игра (не онлайн)
let localGame = null;           // состояние локальной игры

// ==========================================
// ===== УПРАВЛЕНИЕ ЭКРАНАМИ =====
// ==========================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ==========================================
// ===== СОЗДАНИЕ КОМНАТЫ =====
// ==========================================
function createRoom() {
    socket.emit('createRoom', {
        name: tgUser.name,
        telegramId: myTelegramId,
    });
}

// ==========================================
// ===== ПОДКЛЮЧЕНИЕ К КОМНАТЕ =====
// ==========================================
function joinRoom() {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (code.length !== 6) {
        alert('Код должен содержать 6 символов');
        return;
    }
    socket.emit('joinRoom', {
        code,
        name: tgUser.name,
        telegramId: myTelegramId,
    });
}

// ==========================================
// ===== ЛОББИ =====
// ==========================================
function renderLobby() {
    if (!currentRoom) return;

    document.getElementById('lobbyCode').textContent = currentRoom.code;
    document.getElementById('playersCount').textContent = currentRoom.players.length;

    const container = document.getElementById('lobbyPlayers');
    let html = '';
    currentRoom.players.forEach(p => {
        const isHost = p.telegramId === currentRoom.hostId;
        const isMe = p.telegramId === myTelegramId;
        html += `
            <div class="lobby-player">
                <div class="avatar">${p.name[0].toUpperCase()}</div>
                <span>${p.name}${isMe ? ' (ты)' : ''}</span>
                ${isHost ? '<span class="host-badge">👑</span>' : ''}
            </div>
        `;
    });
    container.innerHTML = html;

    // Кнопка "Начать" только у создателя
    const startBtn = document.getElementById('startGameBtn');
    const waitText = document.getElementById('waitingHostText');

    if (currentRoom.hostId === myTelegramId) {
        startBtn.classList.remove('hidden');
        waitText.classList.add('hidden');
    } else {
        startBtn.classList.add('hidden');
        waitText.classList.remove('hidden');
    }
}

function copyCode() {
    if (!currentRoom) return;
    navigator.clipboard.writeText(currentRoom.code);
    alert('✅ Код скопирован: ' + currentRoom.code);
}

function shareLink() {
    if (!currentRoom) return;
    const link = `https://t.me/diceggame_bot/play?startapp=${currentRoom.code}`;
    if (navigator.share) {
        navigator.share({ title: 'PokerDice', text: 'Играй со мной!', url: link });
    } else {
        navigator.clipboard.writeText(link);
        alert('✅ Ссылка скопирована:\n' + link);
    }
}

function leaveRoom() {
    if (confirm('Выйти из комнаты?')) {
        location.reload();
    }
}

// ==========================================
// ===== СТАРТ ОНЛАЙН-ИГРЫ =====
// ==========================================
function startOnlineGame() {
    if (!currentRoom) return;
    socket.emit('startGame', {
        code: currentRoom.code,
        telegramId: myTelegramId,
    });
}

// ==========================================
// ===== БРОСОК КУБИКОВ (онлайн) =====
// ==========================================
function rollDiceOnline() {
    if (!currentRoom || !currentRoom.started) return;
    const current = currentRoom.players[currentRoom.currentPlayerIndex];
    if (current.telegramId !== myTelegramId) return;
    if (current.rollCount >= 3) return;

    socket.emit('rollDice', {
        code: currentRoom.code,
        telegramId: myTelegramId,
    });
}

// ==========================================
// ===== КЛИК ПО КУБИКУ (онлайн) =====
// ==========================================
function onDieClickOnline(index) {
    if (!currentRoom || !currentRoom.started) return;
    const current = currentRoom.players[currentRoom.currentPlayerIndex];
    if (current.telegramId !== myTelegramId) return;
    if (current.rollCount === 0 || current.rollCount === 3) return;

    const newSelected = [...current.selected];
    newSelected[index] = !newSelected[index];

    socket.emit('selectDice', {
        code: currentRoom.code,
        telegramId: myTelegramId,
        selected: newSelected,
    });
}

// ==========================================
// ===== КЛИК ПО ЯЧЕЙКЕ (онлайн) =====
// ==========================================
function onRowClickOnline(label) {
    if (!currentRoom || !currentRoom.started) return;
    const current = currentRoom.players[currentRoom.currentPlayerIndex];
    if (current.telegramId !== myTelegramId) return;
    if (current.scores[label] !== null) return;
    if (current.rollCount === 0) return;

    socket.emit('closeCell', {
        code: currentRoom.code,
        telegramId: myTelegramId,
        label,
    });
}

// ==========================================
// ===== ОТРИСОВКА ИГРЫ (ОНЛАЙН) =====
// ==========================================
function renderOnlineGame() {
    if (!currentRoom) return;

    const current = currentRoom.players[currentRoom.currentPlayerIndex];

    // Список игроков сверху
    renderPlayersBar();

    // Таймер
    const timeLeft = currentRoom.timeLeft || 30;
    document.getElementById('timerFill').style.width = (timeLeft / 30 * 100) + '%';
    document.getElementById('timerText').textContent = timeLeft;

    // Имя текущего игрока
    const isMyTurn = current.telegramId === myTelegramId;
    document.getElementById('playerNameDisplay').textContent =
        `🎲 Ходит: ${current.name}${isMyTurn ? ' (ты)' : ''}`;

    // Инфо
    document.getElementById('turnNum').textContent = current.turn;
    document.getElementById('rollNum').textContent = current.rollCount;

    // Таблица (показываем игрока, который ходит)
    renderTableForPlayer(current);

    // Кубики
    renderDiceForPlayer(current, isMyTurn);

    // Кнопка броска
    const btn = document.getElementById('rollBtn');
    if (!isMyTurn) {
        btn.disabled = true;
        btn.textContent = `👁️ ${current.name} ходит...`;
    } else if (current.rollCount === 3) {
        btn.disabled = true;
        btn.textContent = '⛔ Выбери комбинацию';
    } else if (current.rollCount === 0) {
        btn.disabled = false;
        btn.textContent = '🎲🎲🎲 Крутить';
    } else {
        btn.disabled = false;
        btn.textContent = '🔄🔄🔄 Перебросить';
    }
}

function renderPlayersBar() {
    const bar = document.getElementById('playersBar');
    let html = '';
    currentRoom.players.forEach((p, idx) => {
        const isActive = idx === currentRoom.currentPlayerIndex;
        const isFinished = p.finished;
        const total = getTotalForPlayer(p);
        html += `
            <div class="player-chip ${isActive ? 'active' : ''} ${isFinished ? 'finished' : ''}">
                <div class="chip-avatar">${p.name[0].toUpperCase()}</div>
                <span>${p.name}</span>
                <b>${total}</b>
            </div>
        `;
    });
    bar.innerHTML = html;
}

function getTotalForPlayer(p) {
    let main = 0;
    MAIN_LABELS.forEach(l => { if (p.scores[l] !== null) main += p.scores[l]; });
    if (main < 0) main *= 10;
    let total = main;
    COMBO_LABELS.forEach(l => { if (p.scores[l] !== null) total += p.scores[l]; });
    return total;
}

function renderTableForPlayer(player) {
    const wrap = document.getElementById('tableWrap');
    let html = '';
    const maxRows = Math.max(MAIN_LABELS.length + 1, COMBO_LABELS.length);

    for (let i = 0; i < maxRows; i++) {
        let mainLabel = (i < MAIN_LABELS.length) ? MAIN_LABELS[i] : null;
        let comboLabel = (i < COMBO_LABELS.length) ? COMBO_LABELS[i] : null;
        let mainExtra = (i === MAIN_LABELS.length);

        let mainHTML = '';
        let comboHTML = '';

        if (mainLabel) {
            mainHTML = rowHTMLForPlayer(player, mainLabel);
        } else if (mainExtra) {
            let sum = 0;
            MAIN_LABELS.forEach(l => { if (player.scores[l] !== null) sum += player.scores[l]; });
            if (sum < 0) sum *= 10;
            mainHTML = `
                <div class="table-row-item summary">
                    <span class="label">📊 Сумма 1-6</span>
                    <span class="value">${sum}</span>
                </div>
            `;
        } else {
            mainHTML = `<div class="table-row-item empty"></div>`;
        }

        if (comboLabel) {
            comboHTML = rowHTMLForPlayer(player, comboLabel);
        } else {
            comboHTML = `<div class="table-row-item empty"></div>`;
        }

        html += `<div class="table-row-group">${mainHTML}${comboHTML}</div>`;
    }

    html += `
        <div class="table-row full-width">
            <span class="label">🏆 ИТОГО</span>
            <span class="value">${getTotalForPlayer(player)}</span>
        </div>
    `;

    wrap.innerHTML = html;
}

function rowHTMLForPlayer(player, label) {
    const val = player.scores[label];
    const isClosed = val !== null;
    const isNegative = isClosed && val < 0;

    let cls = 'table-row-item';
    let displayVal;

    if (isClosed) {
        displayVal = val;
        cls += isNegative ? ' closed-negative' : ' closed';
    } else {
        if (player.rollCount === 0) {
            displayVal = '—';
        } else {
            const isFromHand = (player.rollCount === 1);
            const score = calculateScoreForPlayer(label, player.dice, isFromHand);
            displayVal = score;
            if (displayVal > 0) displayVal = '+' + displayVal;
        }
    }

    return `
        <div class="${cls}" onclick="onRowClickOnline('${label}')">
            <span class="label">${label}</span>
            <span class="value">${displayVal}</span>
        </div>
    `;
}

function renderDiceForPlayer(player, isMyTurn) {
    const container = document.getElementById('diceContainer');
    let html = '';

    if (player.dice.length === 0) {
        for (let i = 0; i < 5; i++) {
            html += `<div class="die"><div style="font-size:26px;font-weight:700;color:#ff8906;">${['P','O','K','E','R'][i]}</div></div>`;
        }
    } else {
        player.dice.forEach((val, i) => {
            const sel = player.selected[i] ? 'selected' : '';
            const clickable = isMyTurn ? `onclick="onDieClickOnline(${i})"` : '';
            html += `<div class="die ${sel}" ${clickable}>${renderDieValue(val)}</div>`;
        });
    }

    container.innerHTML = html;
}

function renderDieValue(val) {
    const dots = getDots(val);
    let html = '<div class="dots">';
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const idx = r * 3 + c;
            html += `<div class="dot${dots[idx] ? '' : ' empty'}"></div>`;
        }
    }
    html += '</div>';
    return html;
}

function getDots(val) {
    const map = {
        1: [0,0,0,0,1,0,0,0,0],
        2: [0,0,1,0,0,0,1,0,0],
        3: [0,0,1,0,1,0,1,0,0],
        4: [1,0,1,0,0,0,1,0,1],
        5: [1,0,1,0,1,0,1,0,1],
        6: [1,0,1,1,0,1,1,0,1],
    };
    return map[val] || map[1];
}

// ==========================================
// ===== SOCKET СОБЫТИЯ =====
// ==========================================
socket.on('roomCreated', ({ code, room }) => {
    currentRoom = room;
    showScreen('screenLobby');
    renderLobby();
});

socket.on('roomUpdated', ({ room }) => {
    currentRoom = room;
    renderLobby();
});

socket.on('error', ({ message }) => {
    alert('❌ ' + message);
});

socket.on('gameStarted', ({ room }) => {
    currentRoom = room;
    showScreen('screenGame');
    renderOnlineGame();
});

socket.on('diceRolled', ({ room }) => {
    currentRoom = room;
    renderOnlineGame();
});

socket.on('diceSelected', ({ room }) => {
    currentRoom = room;
    renderOnlineGame();
});

socket.on('cellClosed', ({ room }) => {
    currentRoom = room;
    renderOnlineGame();
});

socket.on('turnChanged', ({ room }) => {
    currentRoom = room;
    renderOnlineGame();
});

socket.on('tick', ({ timeLeft }) => {
    if (currentRoom) {
        currentRoom.timeLeft = timeLeft;
        document.getElementById('timerFill').style.width = (timeLeft / 30 * 100) + '%';
        document.getElementById('timerText').textContent = timeLeft;
    }
});

socket.on('autoTurnDone', ({ room }) => {
    currentRoom = room;
    renderOnlineGame();
});

socket.on('gameEnded', ({ room }) => {
    currentRoom = room;
    showResults(room);
});

// ==========================================
// ===== РЕЗУЛЬТАТЫ =====
// ==========================================
function showResults(room) {
    const sorted = room.players.map((p, idx) => ({
        ...p,
        total: getTotalForPlayer(p),
    })).sort((a, b) => b.total - a.total);

    const medals = ['🥇', '🥈', '🥉'];
    let html = '';
    sorted.forEach((p, idx) => {
        const medal = idx < 3 ? medals[idx] : `${idx + 1}.`;
        html += `
            <div class="result-item ${idx === 0 ? 'winner' : ''}">
                <span class="place">${medal}</span>
                <span class="name">${p.name}</span>
                <span class="score">${p.total}</span>
            </div>
        `;
    });

    document.getElementById('resultsContent').innerHTML = html;
    document.getElementById('resultsModal').classList.add('open');
}

function closeResultsAndExit() {
    location.reload();
}

// ==========================================
// ===== ТАБЛИЦА ИГРОКОВ (промежуточная) =====
// ==========================================
function toggleOnlineScoreboard() {
    if (!currentRoom) return;
    renderScoreboardOnline();
    document.getElementById('scoreboardModal').classList.add('open');
}

function closeScoreboard() {
    document.getElementById('scoreboardModal').classList.remove('open');
}

function renderScoreboardOnline() {
    let html = `<table class="scoreboard-table"><thead><tr><th>Комбинация</th>`;
    currentRoom.players.forEach(p => { html += `<th>${p.name}</th>`; });
    html += `</tr></thead><tbody>`;

    MAIN_LABELS.forEach(label => {
        html += `<tr><td>${label}</td>`;
        currentRoom.players.forEach((p, idx) => {
            const val = p.scores[label];
            const isCur = idx === currentRoom.currentPlayerIndex;
            html += `<td${isCur ? ' class="current-player"' : ''}>${val !== null ? val : '—'}</td>`;
        });
        html += `</tr>`;
    });

    html += `<tr><td>📊 Сумма</td>`;
    currentRoom.players.forEach((p, idx) => {
        let main = 0;
        MAIN_LABELS.forEach(l => { if (p.scores[l] !== null) main += p.scores[l]; });
        if (main < 0) main *= 10;
        const isCur = idx === currentRoom.currentPlayerIndex;
        html += `<td${isCur ? ' class="current-player"' : ''}>${main}</td>`;
    });
    html += `</tr>`;

    COMBO_LABELS.forEach(label => {
        html += `<tr><td>${label}</td>`;
        currentRoom.players.forEach((p, idx) => {
            const val = p.scores[label];
            const isCur = idx === currentRoom.currentPlayerIndex;
            html += `<td${isCur ? ' class="current-player"' : ''}>${val !== null ? val : '—'}</td>`;
        });
        html += `</tr>`;
    });

    html += `<tr class="total-row"><td>🏆 ИТОГО</td>`;
    currentRoom.players.forEach((p, idx) => {
        const isCur = idx === currentRoom.currentPlayerIndex;
        html += `<td${isCur ? ' class="current-player"' : ''}>${getTotalForPlayer(p)}</td>`;
    });
    html += `</tr></tbody></table>`;

    document.getElementById('scoreboardContent').innerHTML = html;
}

// ==========================================
// ===== СПРАВКА =====
// ==========================================
function showHelp() {
    document.getElementById('helpModal').classList.add('open');
}

function closeHelp() {
    document.getElementById('helpModal').classList.remove('open');
}

// ==========================================
// ===== СТАТИСТИКА =====
// ==========================================
async function showStats() {
    showScreen('screenStats');
    const container = document.getElementById('statsContent');
    container.innerHTML = '<p class="hint">Загрузка...</p>';

    try {
        const res = await fetch(`/api/stats/${myTelegramId}`);
        const data = await res.json();

        if (!data.exists) {
            container.innerHTML = `
                <p class="hint" style="text-align:center;padding:40px 20px;">
                    🎮 У тебя пока нет сыгранных онлайн-игр.<br><br>
                    Создай комнату или подключись к друзьям, чтобы начать!
                </p>
            `;
            return;
        }

        const p = data.player;

        let html = `
            <div class="stat-row">
                <span class="stat-label">🎮 Всего игр</span>
                <span class="stat-value">${p.games_played}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">🏆 Побед</span>
                <span class="stat-value">${p.wins} (${p.win_rate}%)</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">🎯 Лучший счёт</span>
                <span class="stat-value highlight">${p.best_score}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">📉 Худший счёт</span>
                <span class="stat-value">${p.worst_score}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">📊 Средний счёт</span>
                <span class="stat-value">${p.avg_score}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">🧮 Коэффициент</span>
                <span class="stat-value highlight">${p.coefficient}</span>
            </div>
        `;

        if (data.games && data.games.length > 0) {
            html += `<div class="games-history"><p class="hint" style="margin:16px 0 8px;">📜 Последние игры:</p>`;
            data.games.forEach(g => {
                const date = new Date(g.played_at).toLocaleDateString('ru-RU');
                const medals = ['🥇', '🥈', '🥉'];
                const medal = g.place <= 3 ? medals[g.place - 1] : `${g.place}.`;
                html += `
                    <div class="history-item">
                        <span class="date">${date}</span>
                        <span class="score">${g.score}</span>
                        <span class="place">${medal}</span>
                    </div>
                `;
            });
            html += `</div>`;
        }

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p class="hint">❌ Ошибка загрузки</p>';
    }
}

// ==========================================
// ===== РЕЙТИНГ =====
// ==========================================
let currentLeaderboardSort = 'score';

async function showLeaderboard() {
    showScreen('screenLeaderboard');
    await loadLeaderboard(currentLeaderboardSort);
}

async function switchLeaderboard(sort, btn) {
    currentLeaderboardSort = sort;
    document.querySelectorAll('.sort-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    await loadLeaderboard(sort);
}

async function loadLeaderboard(sort) {
    const container = document.getElementById('leaderboardContent');
    container.innerHTML = '<p class="hint">Загрузка...</p>';

    try {
        const res = await fetch(`/api/leaderboard?sort=${sort}`);
        const data = await res.json();

        if (!data.players || data.players.length === 0) {
            container.innerHTML = '<p class="hint" style="text-align:center;padding:40px 20px;">Пока никто не играл онлайн 🎲</p>';
            return;
        }

        let html = '';
        data.players.forEach((p, idx) => {
            const isMe = p.id === myTelegramId;
            const medals = ['🥇', '🥈', '🥉'];
            const rank = idx < 3 ? medals[idx] : `${idx + 1}.`;
            const value = sort === 'score' ? p.best_score : p.coefficient;

            html += `
                <div class="leaderboard-item ${isMe ? 'me' : ''}">
                    <span class="rank">${rank}</span>
                    <span class="name">${p.name}${isMe ? ' (ты)' : ''}</span>
                    <span class="score">${value}</span>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p class="hint">❌ Ошибка загрузки</p>';
    }
}

// ==========================================
// ===== ЛОКАЛЬНАЯ ИГРА (упрощённая версия) =====
// ==========================================
function startLocalGame() {
    document.getElementById('localSetupModal').classList.add('open');
    renderLocalInputs();
}

function closeLocalSetup() {
    document.getElementById('localSetupModal').classList.remove('open');
}

let localCount = 2;

function setLocalCount(count) {
    localCount = count;
    document.querySelectorAll('#localSetupModal .count-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.count) === count);
    });
    renderLocalInputs();
}

function renderLocalInputs() {
    const container = document.getElementById('localNamesContainer');
    let html = '';
    for (let i = 1; i <= localCount; i++) {
        html += `
            <div class="player-name-input">
                <label>${i}.</label>
                <input type="text" id="localName${i}" placeholder="Игрок ${i}" value="Игрок ${i}" maxlength="15" />
            </div>
        `;
    }
    container.innerHTML = html;
}

function startLocalMultiplayer() {
    // Временная заглушка — можно расширить локальный режим позже
    alert('Локальный режим в разработке. Пока используй онлайн!');
    closeLocalSetup();
}

// ==========================================
// ===== ВСПОМОГАТЕЛЬНЫЕ =====
// ==========================================
function calculateScoreForPlayer(label, dice, isFromHand) {
    // Упрощённая копия серверной логики для отображения предпросмотра
    if (MAIN_LABELS.includes(label)) {
        const num = parseInt(label);
        const count = dice.filter(d => d === num).length;
        if (count === 3) return 0;
        if (count === 4) return num;
        if (count === 5) return num * 2;
        if (count === 2) return -num;
        if (count === 1) return -num * 2;
        if (count === 0) return -num * 3;
        return 0;
    }

    const freq = {};
    dice.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
    const keys = Object.keys(freq).map(Number);
    let score = 0;

    switch (label) {
        case 'Пара': {
            let maxK = 0;
            for (const k of keys) if (freq[k] >= 2 && k > maxK) maxK = k;
            if (maxK === 0) return 0;
            score = maxK * 2;
            break;
        }
        case '2 пары': {
            const pairs = keys.filter(k => freq[k] >= 2).sort((a,b) => b - a);
            if (pairs.length < 2) return 0;
            score = pairs.slice(0,2).reduce((a,b) => a+b, 0) * 2;
            break;
        }
        case 'Сет': {
            let maxK = 0;
            for (const k of keys) if (freq[k] >= 3 && k > maxK) maxK = k;
            if (maxK === 0) return 0;
            score = maxK * 3;
            break;
        }
        case '3+2': {
            let maxScore = 0;
            for (const k3 of keys) if (freq[k3] >= 3) {
                for (const k2 of keys) if (k2 !== k3 && freq[k2] >= 2) {
                    const s = k3 * 3 + k2 * 2;
                    if (s > maxScore) maxScore = s;
                }
            }
            if (maxScore === 0) return 0;
            score = maxScore;
            break;
        }
        case 'Каре': {
            let maxK = 0;
            for (const k of keys) if (freq[k] >= 4 && k > maxK) maxK = k;
            if (maxK === 0) return 0;
            score = maxK * 4;
            break;
        }
        case 'Малый стрит': {
            const sorted = dice.slice().sort();
            if (sorted.join(',') === [1,2,3,4,5].join(',')) score = 15;
            else return 0;
            break;
        }
        case 'Большой стрит': {
            const sorted = dice.slice().sort();
            if (sorted.join(',') === [2,3,4,5,6].join(',')) score = 20;
            else return 0;
            break;
        }
        case 'Чёт': {
            if (dice.every(d => d % 2 === 0)) score = dice.reduce((a,b) => a+b, 0);
            else return 0;
            break;
        }
        case 'Нечет': {
            if (dice.every(d => d % 2 === 1)) score = dice.reduce((a,b) => a+b, 0);
            else return 0;
            break;
        }
        case 'Покер': {
            const k = keys.find(k => freq[k] === 5);
            if (k === undefined) return 0;
            score = 50 + k * 5;
            break;
        }
        default:
            return 0;
    }

    if (isFromHand) {
        if (label === 'Покер') {
            const k = keys.find(k => freq[k] === 5);
            if (k !== undefined) score = 50 + k * 5 * 2;
        } else {
            score *= 2;
        }
    }

    return score;
}

// ==========================================
// ===== ПРОВЕРКА URL-ПАРАМЕТРА (приглашение) =====
// ==========================================
window.addEventListener('load', () => {
    // Проверяем startapp параметр из Telegram
    let roomCode = null;
    try {
        const tg = window.Telegram.WebApp;
        if (tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
            roomCode = tg.initDataUnsafe.start_param.toUpperCase();
        }
    } catch (e) {}

    if (roomCode && roomCode.length === 6) {
        // Автоматически подключаемся к комнате
        setTimeout(() => {
            showScreen('screenJoin');
            document.getElementById('joinCodeInput').value = roomCode;
            joinRoom();
        }, 500);
    }
});

// Автообновление таймера
setInterval(() => {
    if (currentRoom && currentRoom.started && currentRoom.timeLeft > 0) {
        currentRoom.timeLeft--;
        document.getElementById('timerFill').style.width = (currentRoom.timeLeft / 30 * 100) + '%';
        document.getElementById('timerText').textContent = currentRoom.timeLeft;
    }
}, 1000);