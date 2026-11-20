-- Default disabled. Enable only with the approved sponsor and random parameters.
CREATE TABLE guess_luckybag_config (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 sponsor_id INTEGER NOT NULL REFERENCES users(id), probability_bps INTEGER NOT NULL CHECK(probability_bps BETWEEN 0 AND 10000),
 min_total INTEGER NOT NULL CHECK(min_total BETWEEN 1 AND 1000), max_total INTEGER NOT NULL CHECK(max_total BETWEEN min_total AND 1000),
 activated_at INTEGER NOT NULL
);
CREATE TABLE guess_luckybags (
 packet_id TEXT PRIMARY KEY REFERENCES ldc_packets(packet_id), sponsor_id INTEGER NOT NULL REFERENCES users(id),
 probability_bps INTEGER NOT NULL, min_total INTEGER NOT NULL, max_total INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','scheduled','skipped','open','closing','allocating','settled','refunded')),
 total INTEGER NOT NULL DEFAULT 0 CHECK(total BETWEEN 0 AND 1000), remaining INTEGER NOT NULL DEFAULT 0 CHECK(remaining BETWEEN 0 AND total),
 due_at INTEGER, funded_at INTEGER, ended_at INTEGER, settled_at INTEGER, reason TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX idx_guess_luckybags_work ON guess_luckybags(state,due_at,created_at);
CREATE TABLE guess_luckybag_candidates (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, packet_id TEXT NOT NULL REFERENCES guess_luckybags(packet_id),
 user_id INTEGER NOT NULL REFERENCES users(id), qualified_at INTEGER NOT NULL, UNIQUE(packet_id,user_id)
);
CREATE INDEX idx_guess_luckybag_candidates_order ON guess_luckybag_candidates(packet_id,seq);
CREATE TABLE guess_luckybag_allocations (
 packet_id TEXT NOT NULL REFERENCES guess_luckybags(packet_id), user_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000), paid_at INTEGER, PRIMARY KEY(packet_id,user_id)
);
CREATE TRIGGER guess_luckybag_seed AFTER INSERT ON ldc_packets
 WHEN NEW.mode IN('guess','clues') AND NEW.state='open'
 BEGIN
 INSERT INTO guess_luckybags(packet_id,sponsor_id,probability_bps,min_total,max_total,created_at)
 SELECT NEW.packet_id,sponsor_id,probability_bps,min_total,max_total,NEW.created_at FROM guess_luckybag_config
 WHERE id=1 AND enabled=1 AND NEW.created_at>=activated_at;
END;
CREATE TRIGGER guess_luckybag_question_insert AFTER INSERT ON ldc_questions
 WHEN (NEW.kind='guess' AND ((NEW.score BETWEEN 0 AND 100 AND NEW.verdict IN('similarity','correct')) OR NEW.verdict='no')) OR (NEW.kind='question' AND NEW.verdict IN('yes','no'))
 BEGIN
 INSERT OR IGNORE INTO guess_luckybag_candidates(packet_id,user_id,qualified_at)
 SELECT NEW.packet_id,NEW.user_id,unixepoch() FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id
 JOIN users u ON u.id=NEW.user_id JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=p.group_id
 WHERE b.packet_id=NEW.packet_id AND b.state IN('pending','scheduled','open') AND p.state='open' AND p.ends_at>unixepoch()
 AND u.disabled=0 AND u.kind='user' AND u.id<>p.owner_id
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
 AND ((NEW.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages s WHERE s.id=NEW.source_room_id AND s.packet_id=p.packet_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at))
 OR (NEW.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages s WHERE s.id=NEW.source_message_id AND s.group_id=p.group_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at)))
 AND (SELECT COUNT(*) FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)<1000;
END;
CREATE TRIGGER guess_luckybag_question_update AFTER UPDATE OF verdict,score ON ldc_questions
 WHEN (NEW.kind='guess' AND ((NEW.score BETWEEN 0 AND 100 AND NEW.verdict IN('similarity','correct')) OR NEW.verdict='no')) OR (NEW.kind='question' AND NEW.verdict IN('yes','no'))
 BEGIN
 INSERT OR IGNORE INTO guess_luckybag_candidates(packet_id,user_id,qualified_at)
 SELECT NEW.packet_id,NEW.user_id,unixepoch() FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id
 JOIN users u ON u.id=NEW.user_id JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=p.group_id
 WHERE b.packet_id=NEW.packet_id AND b.state IN('pending','scheduled','open') AND p.state='open' AND p.ends_at>unixepoch()
 AND u.disabled=0 AND u.kind='user' AND u.id<>p.owner_id
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
 AND ((NEW.source_room_id IS NOT NULL AND EXISTS(SELECT 1 FROM guess_room_messages s WHERE s.id=NEW.source_room_id AND s.packet_id=p.packet_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at))
 OR (NEW.source_room_id IS NULL AND EXISTS(SELECT 1 FROM chat_messages s WHERE s.id=NEW.source_message_id AND s.group_id=p.group_id AND s.user_id=u.id AND s.body=NEW.source_body AND s.deleted=0 AND s.created_at>=cm.joined_at)))
 AND (SELECT COUNT(*) FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)<1000;
END;
-- A correct answer can close a round before its question row is finalized.
CREATE TRIGGER guess_luckybag_winner AFTER UPDATE OF recipient_id ON ldc_awards
 WHEN NEW.recipient_id IS NOT NULL AND OLD.recipient_id IS NULL AND NEW.purpose='winner'
 BEGIN
 INSERT OR IGNORE INTO guess_luckybag_candidates(packet_id,user_id,qualified_at)
 SELECT b.packet_id,NEW.recipient_id,unixepoch() FROM guess_luckybags b JOIN ldc_packets p ON p.packet_id=b.packet_id
 JOIN users u ON u.id=NEW.recipient_id JOIN chat_members cm ON cm.user_id=u.id AND cm.group_id=p.group_id
 WHERE b.packet_id=NEW.packet_id AND b.state IN('pending','scheduled','open','closing') AND p.ends_at>unixepoch()
 AND u.disabled=0 AND u.kind='user' AND u.id<>p.owner_id
 AND NOT EXISTS(SELECT 1 FROM account_retirements WHERE source_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE user_id=u.id AND group_id=p.group_id)
 AND (SELECT COUNT(*) FROM guess_luckybag_candidates WHERE packet_id=b.packet_id)<1000;
 UPDATE guess_luckybags SET state=CASE WHEN state='open' THEN 'closing' ELSE 'skipped' END,ended_at=unixepoch(),reason=CASE WHEN state='open' THEN NULL ELSE 'ended_before_appearance' END
 WHERE packet_id=NEW.packet_id AND state IN('pending','scheduled','open') AND
 (SELECT COUNT(*) FROM ldc_awards WHERE packet_id=NEW.packet_id AND recipient_id IS NOT NULL)>=(SELECT count FROM ldc_packets WHERE packet_id=NEW.packet_id);
END;
CREATE TRIGGER guess_luckybag_round_closed AFTER UPDATE OF state ON ldc_packets WHEN NEW.state='closed' BEGIN
 UPDATE guess_luckybags SET state=CASE WHEN state='open' THEN 'closing' ELSE 'skipped' END,ended_at=unixepoch(),reason=CASE WHEN state='open' THEN NULL ELSE 'ended_before_appearance' END
 WHERE packet_id=NEW.packet_id AND state IN('pending','scheduled','open');
END;
CREATE TRIGGER guess_luckybag_refresh AFTER UPDATE OF state ON guess_luckybags WHEN NEW.state<>OLD.state BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;
CREATE TRIGGER guess_luckybag_candidate_refresh AFTER INSERT ON guess_luckybag_candidates BEGIN
 UPDATE ldc_packets SET room_revision=room_revision+1 WHERE packet_id=NEW.packet_id;
END;
