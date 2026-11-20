CREATE TABLE ldc_packets (
 packet_id TEXT PRIMARY KEY REFERENCES chat_redpacks(id), owner_id INTEGER NOT NULL REFERENCES users(id),
 client_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('fixed','random','guess','clues')),
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 100),
 ends_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 answer_box TEXT, hints_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
 question_count INTEGER NOT NULL DEFAULT 0
, group_id INTEGER, game_version INTEGER NOT NULL DEFAULT 0, response_mode TEXT NOT NULL DEFAULT 'yesno' CHECK(response_mode IN ('yesno','similarity')), answer_length INTEGER NOT NULL DEFAULT 0, guess_count INTEGER NOT NULL DEFAULT 0, ai_count INTEGER NOT NULL DEFAULT 0, hints_box TEXT, hints_revealed INTEGER NOT NULL DEFAULT 0, hint_at INTEGER NOT NULL DEFAULT 0, room_revision INTEGER NOT NULL DEFAULT 0, auto_hint_every INTEGER NOT NULL DEFAULT 0 CHECK(auto_hint_every BETWEEN 0 AND 1000), extra_hints_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(extra_hints_json) AND json_type(extra_hints_json)='array'), judge_context_box TEXT, generated INTEGER NOT NULL DEFAULT 0 CHECK(generated IN (0,1)), hint_source TEXT NOT NULL DEFAULT 'legacy' CHECK(hint_source IN('legacy','ai','preset')), preset_hint_trigger TEXT NOT NULL DEFAULT 'cooldown' CHECK(preset_hint_trigger IN('cooldown','guesses')), hint_cooldown_seconds INTEGER NOT NULL DEFAULT 30 CHECK(hint_cooldown_seconds BETWEEN 1 AND 86400), auto_hint_increment INTEGER NOT NULL DEFAULT 0 CHECK(auto_hint_increment BETWEEN 0 AND 1000), escalation_every INTEGER NOT NULL DEFAULT 0, escalation_step_cents INTEGER NOT NULL DEFAULT 0, escalation_cap_cents INTEGER NOT NULL DEFAULT 0, base_total_cents INTEGER NOT NULL DEFAULT 0, added_reward_cents INTEGER NOT NULL DEFAULT 0, reward_finalized INTEGER NOT NULL DEFAULT 0, author_rule_version INTEGER NOT NULL DEFAULT 0, author_result_saved INTEGER NOT NULL DEFAULT 0, hundred_reached INTEGER NOT NULL DEFAULT 0, payment_provider TEXT NOT NULL DEFAULT 'credit' CHECK(payment_provider IN ('credit','fish','coin52')), answer_reference_box TEXT, hidden_winners INTEGER NOT NULL DEFAULT 0 CHECK(hidden_winners BETWEEN 0 AND 9), guess_weights_json TEXT NOT NULL DEFAULT '[10000]', reward_freeze_ai_count INTEGER, close_kind TEXT CHECK(close_kind IN('cancel','vote','force')), close_token TEXT, exclusive_user_id INTEGER REFERENCES users(id), total_cents INTEGER NOT NULL DEFAULT 1 CHECK(total_cents BETWEEN 1 AND CASE WHEN payment_provider='coin52' THEN 20000000 ELSE 200000 END));

CREATE TABLE ldc_awards (
 id TEXT PRIMARY KEY, packet_id TEXT NOT NULL REFERENCES ldc_packets(packet_id), slot INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), recipient_id INTEGER REFERENCES users(id),
 recipient_subject TEXT, recipient_username TEXT,
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','reserved','sent','accepted','unknown','rejected')),
 order_no TEXT NOT NULL UNIQUE, receipt_no TEXT, sent_at INTEGER, checked_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, payment_error TEXT, purpose TEXT NOT NULL DEFAULT 'winner' CHECK(purpose IN('winner','compensation')),
 UNIQUE(packet_id,slot), UNIQUE(packet_id,recipient_id), UNIQUE(packet_id,recipient_subject)
);

CREATE TABLE guess_sidebar_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,nonce TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0, system_kind TEXT, system_ref TEXT, system_data TEXT,UNIQUE(user_id,nonce));

CREATE TRIGGER trg_guess_escalation AFTER UPDATE OF added_reward_cents ON ldc_packets
WHEN NEW.added_reward_cents>OLD.added_reward_cents AND NEW.escalation_every>0
BEGIN
 UPDATE ldc_awards SET amount_cents=CASE WHEN slot=0 THEN NEW.total_cents-
   (SELECT COALESCE(sum(CAST((NEW.total_cents/(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END))*j.value/10000 AS INTEGER)*(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END)),0) FROM json_each(NEW.guess_weights_json) j WHERE j.key>0)
  ELSE CAST((NEW.total_cents/(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END))*json_extract(NEW.guess_weights_json,'$['||slot||']')/10000 AS INTEGER)*(CASE NEW.payment_provider WHEN 'coin52' THEN 100 ELSE 1 END) END
 WHERE packet_id=NEW.packet_id AND (state='ready' AND recipient_id IS NULL OR state='reserved' AND attempts=0 AND sent_at IS NULL);
 INSERT INTO guess_reward_increases(packet_id,stage,added_cents,total_cents,created_at)
 VALUES(NEW.packet_id,(NEW.added_reward_cents+NEW.escalation_step_cents-1)/NEW.escalation_step_cents,NEW.added_reward_cents-OLD.added_reward_cents,NEW.total_cents,unixepoch());
END;

