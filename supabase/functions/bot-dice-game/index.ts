import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleRequest } from './app.ts'

console.log('[BOT-V2] Game bot function started')

serve(async (req) => {
  console.log(`[BOT-V2] ${req.method} ${req.url}`)
  return await handleRequest(req)
})
