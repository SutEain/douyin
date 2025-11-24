import { corsHeaders } from './cors.ts'

export interface ApiResponse<T = any> {
  code: number
  msg: string
  data?: T
}

export function successResponse<T>(data: T, msg = 'ok'): Response {
  const response: ApiResponse<T> = {
    code: 0,
    msg,
    data
  }
  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200
  })
}

export function errorResponse(msg: string, code = 1, status = 400): Response {
  const response: ApiResponse = {
    code,
    msg
  }
  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
  })
}
