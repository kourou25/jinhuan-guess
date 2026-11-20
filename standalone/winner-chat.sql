-- Additive migration. Apply once through the main site's migration ledger.
ALTER TABLE guess_sidebar_messages ADD COLUMN system_kind TEXT;
ALTER TABLE guess_sidebar_messages ADD COLUMN system_ref TEXT;
ALTER TABLE guess_sidebar_messages ADD COLUMN system_data TEXT;
CREATE UNIQUE INDEX guess_sidebar_system_ref ON guess_sidebar_messages(system_kind,system_ref) WHERE system_kind IS NOT NULL;

-- At most ten indexed awards per packet. No answers, wallet reads or user queries.
CREATE VIEW guess_sidebar_winner_snapshot AS
SELECT a.id AS award_id,a.recipient_id AS user_id,
 json_object('version',1,'message_id',r.message_id,'rank',a.slot+1,
 'amount_cents',CASE WHEN p.escalation_every=0 OR p.reward_finalized=1 THEN a.amount_cents ELSE NULL END,
 'payment_provider',p.payment_provider,'state',a.state,
 'needs_fish_setup',CASE WHEN p.payment_provider='fish' AND a.state='rejected' AND a.payment_error='RECIPIENT_NOT_FOUND' THEN 1 ELSE 0 END,
 'remaining_slots',MAX(0,p.count-a.slot-1),
 'remaining_cents',CASE WHEN p.escalation_every=0 OR p.reward_finalized=1 THEN
   MAX(0,p.total_cents-COALESCE((SELECT SUM(w.amount_cents) FROM ldc_awards w WHERE w.packet_id=a.packet_id AND w.purpose='winner' AND w.slot<=a.slot),0)) ELSE NULL END) AS payload
FROM ldc_awards a JOIN ldc_packets p ON p.packet_id=a.packet_id JOIN chat_redpacks r ON r.id=p.packet_id
WHERE p.group_id=1 AND p.mode IN ('guess','clues') AND a.purpose='winner' AND a.recipient_id IS NOT NULL;

-- Only the first reservation creates a message. Payment retries never recreate it.
CREATE TRIGGER guess_sidebar_winner_new AFTER UPDATE OF recipient_id ON ldc_awards
WHEN OLD.recipient_id IS NULL AND NEW.recipient_id IS NOT NULL AND NEW.purpose='winner'
BEGIN
 INSERT OR IGNORE INTO guess_sidebar_messages(user_id,body,nonce,created_at,updated_at,system_kind,system_ref,system_data)
 SELECT user_id,'猜中了本轮，奖励和剩余名额见系统记录。','system:guess-winner:'||award_id,unixepoch(),unixepoch(),'guess_winner',award_id,payload
 FROM guess_sidebar_winner_snapshot WHERE award_id=NEW.id;
END;

CREATE TRIGGER guess_sidebar_winner_payment AFTER UPDATE OF state,amount_cents,payment_error ON ldc_awards
WHEN NEW.recipient_id IS NOT NULL AND NEW.purpose='winner' AND (OLD.state IS NOT NEW.state OR OLD.amount_cents IS NOT NEW.amount_cents OR OLD.payment_error IS NOT NEW.payment_error)
BEGIN
 UPDATE guess_sidebar_messages SET system_data=(SELECT payload FROM guess_sidebar_winner_snapshot WHERE award_id=NEW.id),updated_at=unixepoch()
 WHERE system_kind='guess_winner' AND system_ref=NEW.id
 AND created_at>=(CAST((unixepoch()+28800)/86400 AS INTEGER)*86400-28800)
 AND EXISTS(SELECT 1 FROM guess_sidebar_winner_snapshot WHERE award_id=NEW.id AND payload<>guess_sidebar_messages.system_data);
END;

CREATE TRIGGER guess_sidebar_winner_finalized AFTER UPDATE OF reward_finalized ON ldc_packets
WHEN OLD.reward_finalized IS NOT NEW.reward_finalized AND NEW.reward_finalized=1
BEGIN
 UPDATE guess_sidebar_messages SET system_data=(SELECT payload FROM guess_sidebar_winner_snapshot WHERE award_id=system_ref),updated_at=unixepoch()
 WHERE system_kind='guess_winner' AND system_ref IN (SELECT id FROM ldc_awards WHERE packet_id=NEW.packet_id AND purpose='winner' AND recipient_id IS NOT NULL)
 AND created_at>=(CAST((unixepoch()+28800)/86400 AS INTEGER)*86400-28800)
 AND EXISTS(SELECT 1 FROM guess_sidebar_winner_snapshot WHERE award_id=system_ref AND payload<>guess_sidebar_messages.system_data);
END;
