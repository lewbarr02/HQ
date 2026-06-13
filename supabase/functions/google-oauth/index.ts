import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Google credentials not configured' }), { status: 500, headers: corsHeaders })
    }

    const { action, code, redirect_uri, refresh_token } = await req.json()

    if (action === 'exchange') {
      if (!code || !redirect_uri) {
        return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), { status: 400, headers: corsHeaders })
      }
      const resp = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri,
          grant_type: 'authorization_code',
        }),
      })
      const data = await resp.json()
      if (!resp.ok) return new Response(JSON.stringify({ error: data.error_description || data.error }), { status: resp.status, headers: corsHeaders })
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'refresh') {
      if (!refresh_token) {
        return new Response(JSON.stringify({ error: 'Missing refresh_token' }), { status: 400, headers: corsHeaders })
      }
      const resp = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
        }),
      })
      const data = await resp.json()
      if (!resp.ok) return new Response(JSON.stringify({ error: data.error_description || data.error }), { status: resp.status, headers: corsHeaders })
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: corsHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
