const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from root directory
app.use(express.static(__dirname));

// Global In-Memory Game Room State
const roomState = {
    roomCode: "8472",
    teams: [
        { id: "team_a", name: "Team A", color: "#00f0ff", score: 0 },
        { id: "team_b", name: "Team B", color: "#9d4edd", score: 0 },
        { id: "team_c", name: "Team C", color: "#ff007f", score: 0 }
    ],
    players: [],
    game1: {
        currentRound: 1,
        phase: "select_players", // select_players, number_input, number_reveal, speed_race, round_winner
        selectedPlayers: {},
        submittedNumbers: {},
        targetSum: null,
        timerSeconds: 5,
        submissions: [],
        winner: null
    }
};

let timerInterval = null;

function broadcastState() {
    io.emit('state_sync', roomState);
}

// Socket.io Real-Time Event Handlers
io.on('connection', (socket) => {
    console.log(`⚡ Socket connected: ${socket.id}`);

    // Send immediate state sync on connect
    socket.emit('state_sync', roomState);

    // Player Registration Event
    socket.on('register_player', ({ name, teamId }, callback) => {
        if (!name) return;
        
        const cleanTeamId = (teamId && teamId.trim()) ? teamId.trim() : 'team_a';

        let player = roomState.players.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (player) {
            player.teamId = cleanTeamId;
            player.socketId = socket.id;
        } else {
            player = {
                id: 'p_' + Math.random().toString(36).substr(2, 9),
                socketId: socket.id,
                name: name.trim(),
                teamId: cleanTeamId,
                score: 0
            };
            roomState.players.push(player);
        }

        console.log(`👤 Player Registered: ${player.name} (${player.teamId})`);
        
        if (typeof callback === 'function') {
            callback({ status: 'ok', player });
        }

        broadcastState();
    });

    // Add Team Event
    socket.on('add_team', ({ name, color }) => {
        const newTeam = {
            id: 'team_' + Math.random().toString(36).substr(2, 6),
            name: name || `Team ${String.fromCharCode(65 + roomState.teams.length)}`,
            color: color || '#ffbe0b',
            score: 0
        };
        roomState.teams.push(newTeam);
        broadcastState();
    });

    // Host Action: Start 5-Second Number Input Phase
    socket.on('start_number_phase', (selectedMap) => {
        roomState.game1.selectedPlayers = selectedMap;
        roomState.game1.submittedNumbers = {};
        roomState.game1.phase = "number_input";
        roomState.game1.timerSeconds = 5;

        broadcastState();

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            roomState.game1.timerSeconds -= 1;
            io.emit('timer_tick', roomState.game1.timerSeconds);

            if (roomState.game1.timerSeconds <= 0) {
                clearInterval(timerInterval);
                revealNumbersPhase();
            }
        }, 1000);
    });

    // Player Action: Submit 2-Digit Number
    socket.on('submit_number', ({ playerId, teamId, number }) => {
        const num = parseInt(number, 10);
        if (isNaN(num)) return;

        const cleanTeamId = teamId || 'team_a';
        roomState.game1.submittedNumbers[cleanTeamId] = num;
        console.log(`🔢 Number submitted for ${cleanTeamId}: ${num}`);

        broadcastState();

        const selectedCount = Object.keys(roomState.game1.selectedPlayers).length;
        const submittedCount = Object.keys(roomState.game1.submittedNumbers).length;

        if (submittedCount >= selectedCount && selectedCount > 0) {
            if (timerInterval) clearInterval(timerInterval);
            setTimeout(() => revealNumbersPhase(), 400);
        }
    });

    // Host Action: Force Reveal Numbers
    socket.on('force_reveal', () => {
        if (timerInterval) clearInterval(timerInterval);
        revealNumbersPhase();
    });

    function revealNumbersPhase() {
        if (timerInterval) clearInterval(timerInterval);

        Object.keys(roomState.game1.selectedPlayers).forEach(teamId => {
            if (roomState.game1.submittedNumbers[teamId] === undefined) {
                roomState.game1.submittedNumbers[teamId] = Math.floor(10 + Math.random() * 89);
            }
        });

        let sum = 0;
        Object.values(roomState.game1.submittedNumbers).forEach(n => sum += n);
        roomState.game1.targetSum = sum;
        roomState.game1.phase = "number_reveal";

        console.log(`💡 Numbers Revealed! Target Sum: ${sum}`);
        broadcastState();
    }

    // Host Action: Start Speed Race Phase
    socket.on('start_speed_race', () => {
        roomState.game1.phase = "speed_race";
        roomState.game1.submissions = [];
        roomState.game1.winner = null;

        console.log(`⚡ Speed Race Started! Target: ${roomState.game1.targetSum}`);
        broadcastState();
    });

    // Player Action: Submit Speed Sum Answer
    socket.on('submit_speed_answer', ({ playerId, answer }) => {
        if (roomState.game1.phase !== "speed_race") return;
        if (roomState.game1.winner) return;

        const ans = parseInt(answer, 10);
        const player = roomState.players.find(p => p.id === playerId);
        if (!player) return;

        const isCorrect = (ans === roomState.game1.targetSum);
        const subRecord = {
            playerId: player.id,
            name: player.name,
            teamId: player.teamId,
            answer: ans,
            isCorrect: isCorrect,
            timestamp: Date.now()
        };

        roomState.game1.submissions.push(subRecord);

        if (isCorrect) {
            roomState.game1.winner = subRecord;
            roomState.game1.phase = "round_winner";
            
            player.score += 1;
            const team = roomState.teams.find(t => t.id === player.teamId);
            if (team) team.score += 1;

            console.log(`🏆 Winner: ${player.name} (+1 PT)!`);
        }

        broadcastState();
    });

    // Host Action: Next Round
    socket.on('next_round', () => {
        roomState.game1.currentRound += 1;
        roomState.game1.phase = "select_players";
        roomState.game1.submittedNumbers = {};
        roomState.game1.targetSum = null;
        roomState.game1.submissions = [];
        roomState.game1.winner = null;

        console.log(`🔄 Round ${roomState.game1.currentRound} Started`);
        broadcastState();
    });

    // Host Action: Reset All Scores
    socket.on('reset_game', () => {
        roomState.players.forEach(p => p.score = 0);
        roomState.teams.forEach(t => t.score = 0);
        roomState.game1 = {
            currentRound: 1,
            phase: "select_players",
            selectedPlayers: {},
            submittedNumbers: {},
            targetSum: null,
            timerSeconds: 5,
            submissions: [],
            winner: null
        };
        broadcastState();
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Cosmic Socket.io Game Server running on port ${PORT}`);
});
