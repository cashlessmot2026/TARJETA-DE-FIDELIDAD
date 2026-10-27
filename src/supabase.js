import { createClient } from '@supabase/supabase-js'

// El anon key es público por diseño: solo puede llamar a las funciones RPC
// definidas en supabase/schema.sql (las tablas tienen RLS sin políticas).
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://shrkfzuxpmwkyyqjzcmb.supabase.co'
const KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNocmtmenV4cG13a3l5cWp6Y21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMzk2MDYsImV4cCI6MjEwODcxNTYwNn0.pBnPrgI4v83nl4b51aXkSQkLwdSPEh0O6-2__dhDtik'

export const supabase = createClient(URL, KEY)

export async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}
