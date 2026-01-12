import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zhlkanxfucnsatafeqdp.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpobGthbnhmdWNuc2F0YWZlcWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzIzNjMxNTcsImV4cCI6MjA0NzkzOTE1N30.Xdmay6dswI7scdUQlkKRKjVBM7hGVwqB5RgqBp5FHTs'

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
