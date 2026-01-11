import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleRequest } from './app.ts'

console.log('[BOT-BOOT] Bot function started')

serve(async (req) => {
  console.log(`[BOT-REQ] ${req.method} ${req.url}`)
  return await handleRequest(req)
})
