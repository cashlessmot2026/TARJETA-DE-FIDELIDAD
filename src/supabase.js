import { createClient } from '@supabase/supabase-js'

// El anon key es público por diseño: solo puede llamar a las funciones RPC
// definidas en supabase/schema.sql (las tablas tienen RLS sin políticas).
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://pirshjvxhxrqfqyajuxp.supabase.co'
const KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpcnNoanZ4aHhycWZxeWFqdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMzQ3MDgsImV4cCI6MjEwNzYxMDcwOH0.BeXlNQJSDcMgB8RSsqjLJnIaJ_1ukzAbau49B2hBBZs'

export const supabase = createClient(URL, KEY)

export async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}
