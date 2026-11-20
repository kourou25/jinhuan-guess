CREATE TABLE user_ai_configs (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), revision TEXT NOT NULL,
 name TEXT NOT NULL, base TEXT NOT NULL, model TEXT NOT NULL, key_box TEXT NOT NULL,
 prompt TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), updated_at INTEGER NOT NULL
);
CREATE TABLE user_ai_consents (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 room_id TEXT NOT NULL, config_revision TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('host','player')),
 max_calls INTEGER NOT NULL CHECK(max_calls BETWEEN 1 AND 300), used_calls INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX idx_user_ai_consents_user ON user_ai_consents(user_id,created_at DESC);
CREATE TABLE user_ai_calls (
 id TEXT PRIMARY KEY, consent_id TEXT NOT NULL REFERENCES user_ai_consents(id),
 task TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','done','error')),
 result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_user_ai_calls_consent ON user_ai_calls(consent_id,created_at DESC);
CREATE TRIGGER user_ai_call_count AFTER INSERT ON user_ai_calls BEGIN
 UPDATE user_ai_consents SET used_calls=used_calls+1 WHERE id=NEW.consent_id;
END;
CREATE TABLE game_word_pairs (
 id TEXT PRIMARY KEY, ordinary TEXT NOT NULL, undercover TEXT NOT NULL,
 source TEXT NOT NULL, source_url TEXT, license TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE game_ai_samples (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
 model TEXT NOT NULL, prompt_hash TEXT NOT NULL, task TEXT NOT NULL, body TEXT NOT NULL,
 features TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX idx_game_ai_samples_time ON game_ai_samples(created_at DESC,id);
CREATE TABLE game_word_candidates (
 id TEXT PRIMARY KEY, word TEXT NOT NULL, packet_id TEXT NOT NULL, source_kind TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_game_word_candidates_time ON game_word_candidates(created_at DESC,id);
CREATE TABLE game_room_directory(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),mode TEXT NOT NULL CHECK(mode IN ('drawing','arena')),ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),created_at INTEGER NOT NULL);
CREATE INDEX idx_game_room_directory_time ON game_room_directory(created_at DESC,id);
CREATE INDEX idx_game_room_directory_owner ON game_room_directory(owner_id,created_at DESC);
CREATE TABLE game_style_rules(pattern TEXT PRIMARY KEY,added_by INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL);



CREATE TABLE guess_meme_draws(user_id INTEGER NOT NULL REFERENCES users(id),meme_id INTEGER NOT NULL REFERENCES memes(id),created_at INTEGER NOT NULL,PRIMARY KEY(user_id,meme_id));
CREATE INDEX guess_meme_draws_time ON guess_meme_draws(user_id,created_at);
