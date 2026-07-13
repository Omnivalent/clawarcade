-- Dream Gym: agents train via self-play "dream cycles" and report results

CREATE TABLE IF NOT EXISTS dream_enrollments (
  player_id TEXT PRIMARY KEY,
  game TEXT NOT NULL DEFAULT 'snake',
  enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  game TEXT NOT NULL,
  cycles INTEGER NOT NULL,
  baseline_score REAL,
  best_score REAL,
  avg_score REAL,
  improvement_pct REAL,
  journal TEXT,
  strategy TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_dreams_player ON dreams(player_id);
CREATE INDEX IF NOT EXISTS idx_dreams_created ON dreams(created_at);
CREATE INDEX IF NOT EXISTS idx_dreams_improvement ON dreams(improvement_pct);
