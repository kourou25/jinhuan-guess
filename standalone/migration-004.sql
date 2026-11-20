ALTER TABLE guess_prediction_pools ADD COLUMN ldc_mode TEXT CHECK(ldc_mode IN ('simulated','fish'));
ALTER TABLE guess_prediction_pools ADD COLUMN next_check_at INTEGER NOT NULL DEFAULT 0;
UPDATE guess_prediction_pools SET ldc_mode='simulated' WHERE currency='ldc' AND EXISTS(SELECT 1 FROM guess_prediction_bets b WHERE b.packet_id=guess_prediction_pools.packet_id);
CREATE TABLE guess_fish_pools (
 packet_id TEXT PRIMARY KEY REFERENCES guess_prediction_pools(packet_id),
 custodian_id INTEGER NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 subject TEXT NOT NULL, username TEXT NOT NULL, allocated_at INTEGER, refund INTEGER
);
CREATE TABLE guess_fish_orders (
 order_no TEXT PRIMARY KEY, bet_id TEXT NOT NULL REFERENCES guess_prediction_bets(id),
 kind TEXT NOT NULL CHECK(kind IN ('collect','return')),
 payer_id INTEGER NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 payer_subject TEXT NOT NULL, payer_username TEXT NOT NULL,
 recipient_subject TEXT NOT NULL, recipient_username TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','sending','unknown','accepted','rejected')),
 receipt TEXT, error TEXT, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(bet_id,kind)
);
CREATE INDEX guess_fish_orders_due ON guess_fish_orders(state,next_at,lease_until);
CREATE TRIGGER guess_fish_capacity_insert AFTER INSERT ON guess_fish_orders BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(NEW.payer_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 INSERT INTO fish_capacity_versions(owner_id,revision) SELECT f.custodian_id,1 FROM guess_fish_pools f JOIN guess_prediction_bets b ON b.packet_id=f.packet_id WHERE b.id=NEW.bet_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER guess_fish_room_update AFTER UPDATE OF state ON guess_fish_orders WHEN OLD.state<>NEW.state BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=(SELECT packet_id FROM guess_prediction_bets WHERE id=NEW.bet_id);
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=(SELECT packet_id FROM guess_prediction_bets WHERE id=NEW.bet_id);
 UPDATE chat_messages SET updated_at=unixepoch() WHERE id=(SELECT r.message_id FROM chat_redpacks r JOIN guess_prediction_bets b ON b.packet_id=r.id WHERE b.id=NEW.bet_id);
END;
CREATE TRIGGER guess_prediction_room_update AFTER UPDATE OF state,settlement_token ON guess_prediction_pools WHEN OLD.state<>NEW.state OR OLD.settlement_token IS NOT NEW.settlement_token BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE guess_free_rounds SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
 UPDATE chat_messages SET updated_at=unixepoch() WHERE id=(SELECT message_id FROM chat_redpacks WHERE id=NEW.packet_id);
END;
CREATE TRIGGER guess_fish_capacity_update AFTER UPDATE OF state ON guess_fish_orders WHEN OLD.state<>NEW.state BEGIN
 INSERT INTO fish_capacity_versions(owner_id,revision) VALUES(NEW.payer_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
 INSERT INTO fish_capacity_versions(owner_id,revision) SELECT f.custodian_id,1 FROM guess_fish_pools f JOIN guess_prediction_bets b ON b.packet_id=f.packet_id WHERE b.id=NEW.bet_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1;
END;
