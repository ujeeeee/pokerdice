// ==========================================
// ===== ИМПОРТЫ =====
// ==========================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// ==========================================
// ===== НАСТРОЙКА =====
// ==========================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ===== КОНСТАНТЫ ИГРЫ =====
// ==========================================
const MAIN_LABELS = ['1', '2', '3', '4', '5', '6'];
const COMBO_LABELS = ['Пара', '2 пары', 'Сет', '3+2', 'Каре', 'Малый стрит', 'Большой стрит', 'Чёт', 'Нечет', 'Покер'];
const TURN_TIME = 30;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

const rooms = {};

// ==========================================
// ===== УТИЛИТЫ =====
// ==========================================
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return rooms[code] ? generateRoomCode() : code;
}

function emptyScores() {
    const s = {};
    MAIN_LABELS.forEach(l => s[l] = null);
    COMBO_LABELS.forEach(l => s[l] = null);
    return s;
}

function rollFive() {
    return Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1);
}

// ==========================================
// ===== ЛОГИКА ИГРЫ =====
// ==========================================
function checkCombos(dice) {
    const result = {};
    const sorted = dice.slice().sort();
    const freq = {};
    sorted.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
    const counts = Object.values(freq);

    if (counts.some(c => c >= 2)) result['Пара'] = true;
    const pairs = counts.filter(c => c >= 2);
    if (pairs.length >= 2) result['2 пары'] = true;
    if (counts.some(c => c >= 3)) result['Сет'] = true;
    if (counts.some(c => c === 3) && counts.some(c => c === 2)) result['3+2'] = true;
    if (counts.some(c => c >= 4)) result['Каре'] = true;
    if (sorted.join(',') === [1,2,3,4,5].join(',')) result['Малый стрит'] = true;
    if (sorted.join(',') === [2,3,4,5,6].join(',')) result['Большой стрит'] = true;
    if (dice.every(d => d % 2 === 0)) result['Чёт'] = true;
    if (dice.every(d => d % 2 === 1)) result['Нечет'] = true;
    if (counts.some(c => c === 5)) result['Покер'] = true;
    return result;
}

function calculateScore(label, dice, isFromHand = false) {
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

    if (isFromHand && !MAIN_LABELS.includes(label)) {
        if (label === 'Покер') {
            const k = keys.find(k => freq[k] === 5);
            if (k !== undefined) score = 50 + k * 5 * 2;
        } else {
            score *= 2;
        }
    }

    return score;
}

function getMainSum(scores) {
    let sum = 0;
    MAIN_LABELS.forEach(label => {
        const val = scores[label];
        if (val !== null) sum += val;
    });
    return sum < 0 ? sum * 10 : sum;
}

function getTotal(scores) {
    let total = getMainSum(scores);
    COMBO_LABELS.forEach(label => {
        const val = scores[label];
        if (val !== null) total += val;
    });
    return total;
}

function getAvailableCombos(dice, scores) {
    const available = [];
    MAIN_LABELS.forEach(label => {
        if (scores[label] !== null) return;
        const num = parseInt(label);
        const count = dice.filter(d => d === num).length;
        if (count >= 3) available.push(label);
    });
    const combos = checkCombos(dice);
    COMBO_LABELS.forEach(label => {
        if (scores[label] !== null) return;
        if (combos[label]) available.push(label);
    });
    return available;
}

function getAllEmpty(scores) {
    const empty = [];
    MAIN_LABELS.forEach(l => { if (scores[l] === null) empty.push(l); });
    COMBO_LABELS.forEach(l => { if (scores[l] === null) empty.push(l); });
    return empty;
}

// ==========================================
// ===== СОХРАНЕНИЕ В SUPABASE =====
// ==========================================
async function saveGameResults(players, roomCode) {
    try {
        const ranked = players.map((p, idx) => ({
            ...p,
            index: idx,
            total: getTotal(p.scores),
        })).sort((a, b) => b.total - a.total);

        for (let i = 0; i < ranked.length; i++) {
            const p = ranked[i];
            const place = i + 1;
            const total = p.total;
            const mainSum = getMainSum(p.scores);

            const { data: existing } = await supabase
                .from('players')
                .select('*')
                .eq('id', p.telegramId)
                .single();

            if (existing) {
                await supabase
                    .from('players')
                    .update({
                        name: p.name,
                        games_played: existing.games_played + 1,
                        total_score: existing.total_score + total,
                        best_score: Math.max(existing.best_score, total),
                        worst_score: existing.worst_score === 0
                            ? total
                            : Math.min(existing.worst_score, total),
                        wins: existing.wins + (place === 1 ? 1 : 0),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', p.telegramId);
            } else {
                await supabase
                    .from('players')
                    .insert({
                        id: p.telegramId,
                        name: p.name,
                        games_played: 1,
                        total_score: total,
                        best_score: total,
                        worst_score: total,
                        wins: place === 1 ? 1 : 0,
                    });
            }

            const opponents = players
                .filter(op => op.telegramId !== p.telegramId)
                .map(op => String(op.telegramId));

            await supabase
                .from('games')
                .insert({
                    player_id: p.telegramId,
                    room_code: roomCode,
                    score: total,
                    place: place,
                    players_count: players.length,
                    opponents: opponents,
                    scores_main: mainSum,
                    scores_combos: total - mainSum,
                });
        }

        console.log(`✅ Результаты игры ${roomCode} сохранены`);
    } catch (err) {
        console.error('❌ Ошибка сохранения:', err);
    }
}

// ==========================================
// ===== SOCKET.IO =====
// ==========================================
io.on('connection', (socket) => {
    console.log('🔌 Подключение:', socket.id);

    // ----- СОЗДАНИЕ КОМНАТЫ -----
    socket.on('createRoom', ({ name, telegramId }) => {
        const code = generateRoomCode();

        rooms[code] = {
            code,
            hostId: telegramId,
            players: [{
                socketId: socket.id,
                telegramId,
                name,
                scores: emptyScores(),
                turn: 1,
                finished: false,
                dice: [],
                selected: [false, false, false, false, false],
                rollCount: 0,
                available: [],
            }],
            currentPlayerIndex: 0,
            started: false,
            timer: null,
            timeLeft: TURN_TIME,
        };

        socket.join(code);
        socket.emit('roomCreated', { code, room: sanitizeRoom(rooms[code]) });
        console.log(`🎮 Комната создана: ${code}`);
    });

    // ----- ПОДКЛЮЧЕНИЕ К КОМНАТЕ -----
    socket.on('joinRoom', ({ code, name, telegramId }) => {
        const room = rooms[code];

        if (!room) {
            socket.emit('error', { message: 'Комната не найдена' });
            return;
        }
        if (room.started) {
            socket.emit('error', { message: 'Игра уже началась' });
            return;
        }
        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('error', { message: 'Комната заполнена' });
            return;
        }
        if (room.players.some(p => p.telegramId === telegramId)) {
            socket.emit('error', { message: 'Ты уже в комнате' });
            return;
        }

        room.players.push({
            socketId: socket.id,
            telegramId,
            name,
            scores: emptyScores(),
            turn: 1,
            finished: false,
            dice: [],
            selected: [false, false, false, false, false],
            rollCount: 0,
            available: [],
        });

        socket.join(code);

        // Отправляем новому игроку — чтобы он перешёл в лобби
        socket.emit('joinedRoom', { room: sanitizeRoom(room) });

        // Всем остальным — обновление списка
        io.to(code).emit('roomUpdated', { room: sanitizeRoom(room) });
        console.log(`👤 ${name} подключился к ${code}`);
    });

    // ----- СТАРТ ИГРЫ -----
    socket.on('startGame', ({ code, telegramId }) => {
        const room = rooms[code];
        if (!room) return;
        if (room.hostId !== telegramId) {
            socket.emit('error', { message: 'Только создатель может начать' });
            return;
        }
        if (room.players.length < MIN_PLAYERS) {
            socket.emit('error', { message: `Нужно минимум ${MIN_PLAYERS} игрока` });
            return;
        }

        room.started = true;
        room.currentPlayerIndex = 0;

        io.to(code).emit('gameStarted', { room: sanitizeRoom(room) });
        startTurnTimer(code);
        console.log(`🚀 Игра началась в ${code}`);
    });

    // ----- БРОСОК КУБИКОВ -----
    socket.on('rollDice', ({ code, telegramId }) => {
        const room = rooms[code];
        if (!room || !room.started) return;

        const current = room.players[room.currentPlayerIndex];
        if (current.telegramId !== telegramId) return;
        if (current.rollCount >= 3) return;

        current.dice = current.dice.length === 0
            ? rollFive()
            : current.dice.map((v, i) => current.selected[i] ? v : Math.floor(Math.random() * 6) + 1);

        current.rollCount++;
        current.selected = [false, false, false, false, false];
        current.available = getAvailableCombos(current.dice, current.scores);

        if (current.rollCount === 3 && current.available.length === 0) {
            current.available = getAllEmpty(current.scores);
        }

        io.to(code).emit('diceRolled', { room: sanitizeRoom(room) });
    });

    // ----- ВЫБОР КУБИКОВ -----
    socket.on('selectDice', ({ code, telegramId, selected }) => {
        const room = rooms[code];
        if (!room || !room.started) return;

        const current = room.players[room.currentPlayerIndex];
        if (current.telegramId !== telegramId) return;

        current.selected = selected;
        io.to(code).emit('diceSelected', { room: sanitizeRoom(room) });
    });

    // ----- ЗАКРЫТИЕ ЯЧЕЙКИ -----
    socket.on('closeCell', ({ code, telegramId, label }) => {
        const room = rooms[code];
        if (!room || !room.started) return;

        const current = room.players[room.currentPlayerIndex];
        if (current.telegramId !== telegramId) return;
        if (current.scores[label] !== null) return;
        if (current.rollCount === 0) return;

        const isFromHand = current.rollCount === 1;
        const val = calculateScore(label, current.dice, isFromHand);
        current.scores[label] = val;
        current.turn++;

        current.rollCount = 0;
        current.dice = [];
        current.selected = [false, false, false, false, false];
        current.available = [];

        const allClosed = MAIN_LABELS.every(l => current.scores[l] !== null) &&
                          COMBO_LABELS.every(l => current.scores[l] !== null);
        if (allClosed || current.turn > 16) {
            current.finished = true;
        }

        io.to(code).emit('cellClosed', { room: sanitizeRoom(room) });

        clearTurnTimer(code);
        nextTurn(code);
    });

    // ----- ОТКЛЮЧЕНИЕ -----
    socket.on('disconnect', () => {
        console.log('❌ Отключение:', socket.id);
        for (const code in rooms) {
            const room = rooms[code];
            const idx = room.players.findIndex(p => p.socketId === socket.id);
            if (idx !== -1) {
                const leavingPlayer = room.players[idx];

                // Если игра НЕ началась — удаляем игрока из лобби
                if (!room.started) {
                    room.players.splice(idx, 1);

                    // Если комната опустела — удаляем
                    if (room.players.length === 0) {
                        delete rooms[code];
                        console.log(`🗑️ Комната ${code} удалена (все вышли)`);
                        break;
                    }

                    // Если остался 1 игрок — комната закрывается
                    if (room.players.length === 1) {
                        io.to(code).emit('roomClosed', {
                            message: '❌ Все игроки вышли. Комната закрыта.'
                        });
                        delete rooms[code];
                        console.log(`🗑️ Комната ${code} удалена (остался 1 игрок)`);
                        break;
                    }

                    // Если вышел создатель — передаём права следующему
                    if (room.hostId === leavingPlayer.telegramId) {
                        room.hostId = room.players[0].telegramId;
                        console.log(`👑 В комнате ${code} новый создатель: ${room.players[0].name}`);
                    }

                    io.to(code).emit('roomUpdated', { room: sanitizeRoom(room) });
                    console.log(`👤 ${leavingPlayer.name} покинул комнату ${code}`);
                }
                // Если игра ИДЁТ — оставляем (таймер продолжает идти)
                else {
                    console.log(`⚠️ ${leavingPlayer.name} отключился во время игры ${code}`);
                }
                break;
            }
        }
    });
});

// ==========================================
// ===== УПРАВЛЕНИЕ ХОДАМИ =====
// ==========================================
function sanitizeRoom(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        started: room.started,
        currentPlayerIndex: room.currentPlayerIndex,
        timeLeft: room.timeLeft,
        players: room.players.map(p => ({
            telegramId: p.telegramId,
            name: p.name,
            scores: p.scores,
            turn: p.turn,
            finished: p.finished,
            dice: p.dice,
            selected: p.selected,
            rollCount: p.rollCount,
            available: p.available,
        })),
    };
}

function nextTurn(code) {
    const room = rooms[code];
    if (!room) return;

    let nextIndex = room.currentPlayerIndex;
    let found = false;
    for (let i = 1; i <= room.players.length; i++) {
        const idx = (room.currentPlayerIndex + i) % room.players.length;
        if (!room.players[idx].finished) {
            nextIndex = idx;
            found = true;
            break;
        }
    }

    if (!found) {
        endGame(code);
        return;
    }

    room.currentPlayerIndex = nextIndex;
    io.to(code).emit('turnChanged', { room: sanitizeRoom(room) });
    startTurnTimer(code);
}

function startTurnTimer(code) {
    const room = rooms[code];
    if (!room) return;

    room.timeLeft = TURN_TIME;

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(code).emit('tick', { timeLeft: room.timeLeft });

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            autoTurn(code);
        }
    }, 1000);
}

function clearTurnTimer(code) {
    const room = rooms[code];
    if (!room) return;
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }
}

function autoTurn(code) {
    const room = rooms[code];
    if (!room || !room.started) return;

    const current = room.players[room.currentPlayerIndex];

    if (current.rollCount === 0) {
        current.dice = rollFive();
        current.rollCount = 1;
        current.available = getAvailableCombos(current.dice, current.scores);
        if (current.available.length === 0) {
            current.available = getAllEmpty(current.scores);
        }
    }

    const available = current.available.length > 0
        ? current.available
        : getAllEmpty(current.scores);

    if (available.length > 0) {
        const randomLabel = available[Math.floor(Math.random() * available.length)];
        const isFromHand = current.rollCount === 1;
        const val = calculateScore(randomLabel, current.dice, isFromHand);
        current.scores[randomLabel] = val;
        current.turn++;
    }

    current.rollCount = 0;
    current.dice = [];
    current.selected = [false, false, false, false, false];
    current.available = [];

    const allClosed = MAIN_LABELS.every(l => current.scores[l] !== null) &&
                      COMBO_LABELS.every(l => current.scores[l] !== null);
    if (allClosed || current.turn > 16) {
        current.finished = true;
    }

    io.to(code).emit('autoTurnDone', { room: sanitizeRoom(room) });

    setTimeout(() => nextTurn(code), 500);
}

async function endGame(code) {
    const room = rooms[code];
    if (!room) return;

    io.to(code).emit('gameEnded', { room: sanitizeRoom(room) });

    await saveGameResults(room.players, code);

    setTimeout(() => {
        delete rooms[code];
        console.log(`🗑️ Комната ${code} удалена после игры`);
    }, 5 * 60 * 1000);
}

// ==========================================
// ===== API ДЛЯ СТАТИСТИКИ =====
// ==========================================
app.get('/api/stats/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;

        const { data: player, error: pErr } = await supabase
            .from('players')
            .select('*')
            .eq('id', telegramId)
            .single();

        if (pErr || !player) {
            return res.json({ exists: false });
        }

        const { data: games } = await supabase
            .from('games')
            .select('*')
            .eq('player_id', telegramId)
            .order('played_at', { ascending: false })
            .limit(50);

        const { data: globalStats } = await supabase
            .from('players')
            .select('total_score, games_played');

        let globalAvg = 0;
        if (globalStats && globalStats.length > 0) {
            const totalScore = globalStats.reduce((s, p) => s + p.total_score, 0);
            const totalGames = globalStats.reduce((s, p) => s + p.games_played, 0);
            globalAvg = totalGames > 0 ? totalScore / totalGames : 0;
        }

        const C = 5;
        const coefficient = player.games_played > 0
            ? (player.total_score + C * globalAvg) / (player.games_played + C)
            : 0;

        res.json({
            exists: true,
            player: {
                ...player,
                avg_score: player.games_played > 0
                    ? Math.round(player.total_score / player.games_played)
                    : 0,
                coefficient: Math.round(coefficient),
                win_rate: player.games_played > 0
                    ? Math.round(player.wins / player.games_played * 100)
                    : 0,
            },
            games: games || [],
        });
    } catch (err) {
        console.error('Ошибка /api/stats:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const { sort = 'score' } = req.query;

        const { data: players, error } = await supabase
            .from('players')
            .select('*')
            .order(sort === 'score' ? 'best_score' : 'total_score', { ascending: false })
            .limit(100);

        if (error) throw error;

        const { data: globalStats } = await supabase
            .from('players')
            .select('total_score, games_played');

        let globalAvg = 0;
        if (globalStats && globalStats.length > 0) {
            const totalScore = globalStats.reduce((s, p) => s + p.total_score, 0);
            const totalGames = globalStats.reduce((s, p) => s + p.games_played, 0);
            globalAvg = totalGames > 0 ? totalScore / totalGames : 0;
        }

        const C = 5;
        const enriched = players.map(p => ({
            ...p,
            avg_score: p.games_played > 0
                ? Math.round(p.total_score / p.games_played)
                : 0,
            coefficient: p.games_played > 0
                ? Math.round((p.total_score + C * globalAvg) / (p.games_played + C))
                : 0,
        }));

        if (sort === 'coefficient') {
            enriched.sort((a, b) => b.coefficient - a.coefficient);
        }

        res.json({ players: enriched });
    } catch (err) {
        console.error('Ошибка /api/leaderboard:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==========================================
// ===== ЗАПУСК =====
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Открой http://localhost:${PORT}`);
});