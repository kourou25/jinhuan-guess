import type { Context } from 'hono'
import type { Env } from './env'

export type User = {
  id: number
  username: string
  name: string | null
  avatar: string | null
  trust_level: number
  silenced: number
  is_admin: number
  notif_read?: number
  notif_prefs?: string | null
  nick?: string | null
  bio?: string | null
  last_seen?: number
  fancy?: number | null
  deco?: string | null
  role?: string | null
  kind?: 'user' | 'bot'
  disabled?: number
}

export type Puzzle = {
  id: number
  meme_id: number
  creator_id: number
  hint: string
  answer_hash: string
  salt: string
  reward_kind: 'secret' | 'credit' | 'cdk'
  reward_type: 'text' | 'link' | 'codes'
  reward_text: string
  min_trust_level: number
  max_attempts: number
  max_winners: number
  winners_count: number
  ends_at: number | null
  created_at: number
}

export type Ctx = { Bindings: Env; Variables: { user: User | null } }
export type C = Context<Ctx>

