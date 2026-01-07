import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SUPABASE_SERVICE_KEY, SUPABASE_URL } from './env.ts'

// bot-dice-game: Supabase client（service role）
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
