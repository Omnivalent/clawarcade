/**
 * Pong Matchmaking Lobby Worker
 * Uses Durable Objects to maintain lobby state and match players
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    // WebSocket upgrade for lobby
    if (url.pathname === '/ws/pong-lobby') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      
      // Get the lobby Durable Object
      const lobbyId = env.PONG_LOBBY.idFromName('global-lobby');
      const lobby = env.PONG_LOBBY.get(lobbyId);
      
      return lobby.fetch(request);
    }
    
    // WebSocket upgrade for match
    const matchPath = url.pathname.match(/^\/ws\/match\/([a-zA-Z0-9-]+)$/);
    if (matchPath) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      
      const matchId = matchPath[1];
      const matchDOId = env.PONG_MATCH.idFromName(matchId);
      const match = env.PONG_MATCH.get(matchDOId);
      
      return match.fetch(request);
    }
    
    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'pong-lobby' });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

// Pong Lobby Durable Object - handles matchmaking queue
export class PongLobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = []; // Players waiting for match
  }
  
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    const playerId = crypto.randomUUID();
    
    server.accept();
    
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleMessage(server, playerId, msg);
      } catch (e) {
        console.error('Message error:', e);
      }
    });
    
    server.addEventListener('close', () => {
      this.removeFromQueue(playerId);
    });
    
    server.addEventListener('error', () => {
      this.removeFromQueue(playerId);
    });
    
    return new Response(null, { status: 101, webSocket: client });
  }
  
  async handleMessage(ws, playerId, msg) {
    switch (msg.type) {
      case 'join_queue':
        await this.joinQueue(ws, playerId, msg.nickname || 'Player', msg.tournamentId);
        break;
        
      case 'leave_queue':
        this.removeFromQueue(playerId);
        break;
        
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }
  
  async joinQueue(ws, playerId, nickname, tournamentId) {
    // Check if already in queue
    const existing = this.queue.find(p => p.id === playerId);
    if (existing) return;
    
    // Add to queue
    this.queue.push({
      id: playerId,
      ws: ws,
      nickname: nickname,
      tournamentId: tournamentId,
      joinedAt: Date.now()
    });
    
    // Notify queue size
    this.broadcastQueueUpdate();
    
    // Try to match
    await this.tryMatch();
  }
  
  removeFromQueue(playerId) {
    const idx = this.queue.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this.broadcastQueueUpdate();
    }
  }
  
  broadcastQueueUpdate() {
    const count = this.queue.length;
    const msg = JSON.stringify({ type: 'queue_update', count: count });
    
    this.queue.forEach(player => {
      try {
        player.ws.send(msg);
      } catch (e) {}
    });
  }
  
  async tryMatch() {
    // Need at least 2 players
    if (this.queue.length < 2) return;
    
    // Match first two players (FIFO)
    const player1 = this.queue.shift();
    const player2 = this.queue.shift();
    
    // Generate match ID
    const matchId = crypto.randomUUID();
    
    // Notify both players
    try {
      player1.ws.send(JSON.stringify({
        type: 'match_found',
        matchId: matchId,
        opponent: player2.nickname,
        color: 'bottom' // Player 1 is bottom paddle
      }));
    } catch (e) {}
    
    try {
      player2.ws.send(JSON.stringify({
        type: 'match_found',
        matchId: matchId,
        opponent: player1.nickname,
        color: 'top' // Player 2 is top paddle
      }));
    } catch (e) {}
    
    // Update queue for remaining players
    this.broadcastQueueUpdate();
  }
}

// Pong Match Durable Object - handles actual game state
export class PongMatch {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map(); // playerId -> { ws, nickname, paddle }
    this.gameState = {
      ball: { x: 0.5, y: 0.5, vx: 0.02, vy: 0.02 },
      scores: { bottom: 0, top: 0 },
      started: false
    };
  }
  
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
    
    server.accept();
    
    server.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleMessage(server, playerId, msg);
      } catch (e) {
        console.error('Match message error:', e);
      }
    });
    
    server.addEventListener('close', () => {
      this.handleDisconnect(playerId);
    });
    
    return new Response(null, { status: 101, webSocket: client });
  }
  
  async handleMessage(ws, playerId, msg) {
    switch (msg.type) {
      case 'join':
        this.players.set(playerId, {
          ws: ws,
          nickname: msg.nickname || 'Player',
          paddle: this.players.size === 0 ? 'bottom' : 'top',
          paddleX: 0.5
        });
        
        // Start game when 2 players
        if (this.players.size === 2) {
          this.startGame();
        }
        break;
        
      case 'paddle':
        const player = this.players.get(playerId);
        if (player) {
          player.paddleX = msg.x;
          // Broadcast to opponent
          this.broadcastToOthers(playerId, {
            type: 'paddle',
            x: msg.x
          });
        }
        break;
        
      case 'ball':
        // Player hit ball, broadcast new state
        this.gameState.ball = msg.ball;
        this.broadcastToOthers(playerId, {
          type: 'ball',
          ...msg.ball
        });
        break;
        
      case 'score':
        this.gameState.scores = msg.scores;
        this.broadcast({
          type: 'score',
          yourScore: msg.myScore,
          opponentScore: msg.opponentScore
        });
        break;
    }
  }
  
  startGame() {
    this.gameState.started = true;
    
    this.players.forEach((player, id) => {
      try {
        const opponent = [...this.players.values()].find(p => p !== player);
        player.ws.send(JSON.stringify({
          type: 'game_start',
          opponent: opponent?.nickname || 'Opponent',
          paddle: player.paddle
        }));
      } catch (e) {}
    });
  }
  
  handleDisconnect(playerId) {
    this.players.delete(playerId);
    
    // Notify remaining player
    this.broadcast({
      type: 'opponent_disconnected'
    });
  }
  
  broadcast(msg) {
    const data = JSON.stringify(msg);
    this.players.forEach(player => {
      try { player.ws.send(data); } catch (e) {}
    });
  }
  
  broadcastToOthers(excludeId, msg) {
    const data = JSON.stringify(msg);
    this.players.forEach((player, id) => {
      if (id !== excludeId) {
        try { player.ws.send(data); } catch (e) {}
      }
    });
  }
}
