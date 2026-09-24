import http.server
import socketserver
import json
import os
import mimetypes

PORT = 3000

# Global In-Memory Game Room State
room_state = {
    "roomCode": "8472",
    "teams": [
        {"id": "team_a", "name": "Team A", "color": "#00f0ff", "score": 0},
        {"id": "team_b", "name": "Team B", "color": "#9d4edd", "score": 0},
        {"id": "team_c", "name": "Team C", "color": "#ff007f", "score": 0}
    ],
    "players": [],
    "game1": {
        "currentRound": 1,
        "phase": "select_players",
        "selectedPlayers": {},
        "submittedNumbers": {},
        "targetSum": None,
        "timerSeconds": 5,
        "submissions": [],
        "winner": None
    }
}

class CosmicHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning, Authorization')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/state'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(room_state).encode('utf-8'))
        else:
            clean_path = self.path.split('?')[0]
            if clean_path == '/':
                clean_path = '/index.html'
            
            file_path = os.path.join(os.getcwd(), clean_path.lstrip('/'))
            if os.path.exists(file_path) and os.path.isfile(file_path):
                self.send_response(200)
                mime_type, _ = mimetypes.guess_type(file_path)
                self.send_header('Content-Type', mime_type or 'application/octet-stream')
                self.end_headers()
                with open(file_path, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(404)
                self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            payload = json.loads(post_data.decode('utf-8')) if post_data else {}
        except Exception:
            payload = {}

        clean_path = self.path.split('?')[0]

        if clean_path == '/api/register':
            name = payload.get('name', '').strip()
            team_id = payload.get('teamId', 'team_a')
            if name:
                existing = next((p for p in room_state['players'] if p['name'].lower() == name.lower()), None)
                if existing:
                    existing['teamId'] = team_id
                else:
                    new_p = {
                        "id": "p_" + str(len(room_state['players']) + 1) + "_" + str(abs(hash(name)) % 10000),
                        "name": name,
                        "teamId": team_id,
                        "score": 0
                    }
                    room_state['players'].append(new_p)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(room_state).encode('utf-8'))

        elif clean_path == '/api/host/update':
            if 'teams' in payload: room_state['teams'] = payload['teams']
            if 'players' in payload: room_state['players'] = payload['players']
            if 'game1' in payload: room_state['game1'] = payload['game1']

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(room_state).encode('utf-8'))

        elif clean_path == '/api/player/submit_number':
            player_id = payload.get('playerId')
            team_id = payload.get('teamId')
            num = payload.get('number')
            if team_id and num is not None:
                room_state['game1']['submittedNumbers'][team_id] = int(num)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(room_state).encode('utf-8'))

        elif clean_path == '/api/player/submit_answer':
            player_id = payload.get('playerId')
            ans = payload.get('answer')
            
            player = next((p for p in room_state['players'] if p['id'] == player_id), None)
            if player and ans is not None:
                target = room_state['game1'].get('targetSum')
                is_correct = (int(ans) == target) if target is not None else False
                
                sub_record = {
                    "playerId": player['id'],
                    "name": player['name'],
                    "teamId": player['teamId'],
                    "answer": int(ans),
                    "isCorrect": is_correct,
                    "timestamp": payload.get('timestamp')
                }
                room_state['game1']['submissions'].append(sub_record)

                if is_correct and not room_state['game1']['winner']:
                    room_state['game1']['winner'] = sub_record
                    room_state['game1']['phase'] = 'round_winner'
                    player['score'] += 1
                    team = next((t for t in room_state['teams'] if t['id'] == player['teamId']), None)
                    if team: team['score'] += 1

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(room_state).encode('utf-8'))

        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    handler = CosmicHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"Cosmic HTTP REST Game Server running on 0.0.0.0:{PORT}")
        httpd.serve_forever()
