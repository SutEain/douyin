import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleRequest } from './app.ts'

console.log('[DICE-BOT-BOOT] Dice game bot function started')

serve(async (req) => {
  console.log(`[DICE-BOT-REQ] ${req.method} ${req.url}`)
  return await handleRequest(req)
})
