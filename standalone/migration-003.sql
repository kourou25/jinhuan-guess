CREATE TABLE IF NOT EXISTS guess_prediction_pools (
 packet_id TEXT PRIMARY KEY, currency TEXT NOT NULL CHECK(currency IN('coin52','ldc')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN('open','settled','refunded')),
 winner_id INTEGER, created_at INTEGER NOT NULL, settled_at INTEGER, revision INTEGER NOT NULL DEFAULT 0, settlement_token TEXT
);
CREATE TABLE IF NOT EXISTS guess_prediction_bets (
 id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES guess_prediction_pools(packet_id),
 user_id INTEGER NOT NULL REFERENCES users(id), target_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount>0), created_at INTEGER NOT NULL,
 result_amount INTEGER, result_kind TEXT, settled_at INTEGER,
 UNIQUE(packet_id,user_id), CHECK(user_id<>target_id)
);
CREATE INDEX IF NOT EXISTS idx_prediction_open ON guess_prediction_bets(packet_id,settled_at);
-- Only the local fixture can credit this simulated balance; never represents real LDC.
CREATE TABLE IF NOT EXISTS guess_simulated_ldc_wallets(user_id INTEGER PRIMARY KEY REFERENCES users(id),balance INTEGER NOT NULL CHECK(balance>=0));
CREATE TABLE IF NOT EXISTS guess_prediction_ledger(
 ref TEXT PRIMARY KEY,user_id INTEGER NOT NULL,currency TEXT NOT NULL,delta INTEGER NOT NULL,created_at INTEGER NOT NULL
);
