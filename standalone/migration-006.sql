CREATE TABLE guess_login_codes(code_hash TEXT PRIMARY KEY,state_hash TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,claim TEXT);
CREATE INDEX guess_login_expiry ON guess_login_codes(expires_at);
CREATE TABLE guess_sidebar_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,nonce TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,nonce));
CREATE INDEX guess_sidebar_user_time ON guess_sidebar_messages(user_id,created_at);
CREATE INDEX guess_sidebar_updated ON guess_sidebar_messages(updated_at,id);
CREATE INDEX guess_sidebar_created ON guess_sidebar_messages(created_at,id);
CREATE INDEX guess_prediction_due ON guess_prediction_pools(state,next_check_at,packet_id);
CREATE INDEX guess_fish_payer_capacity ON guess_fish_orders(payer_id,client_id,kind,state);
CREATE INDEX guess_fish_custodian_capacity ON guess_fish_pools(custodian_id,client_id,packet_id);
