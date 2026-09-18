import { Icon } from './ui'
import { PLATFORM_NAME } from '../lib/store'

/**
 * Shown instead of the app when VITE_SUPABASE_* are still placeholders, so the
 * first run explains itself rather than throwing a network error.
 */
export default function SetupNotice() {
  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 py-12 max-w-md mx-auto">
      <span className="font-headline font-black text-3xl text-brand tracking-tight mb-6">{PLATFORM_NAME}</span>
      <div className="flex items-center gap-2 mb-3">
        <Icon name="settings" className="text-accent" />
        <h1 className="font-headline font-extrabold text-xl">One setup step left</h1>
      </div>
      <p className="text-muted mb-5 leading-relaxed">
        The app is built and ready, but it is not yet pointed at a database.
      </p>
      <ol className="flex flex-col gap-3 mb-6 text-sm">
        {[
          ['Create a free project at supabase.com', null],
          ['Run the four files in supabase/migrations/ in the SQL editor, in order', null],
          ['Run supabase/seed.sql to load the starter catalogue', null],
          ['Copy your project URL and anon key into .env.local', null],
          ['Restart the dev server', null],
        ].map(([step], i) => (
          <li key={i} className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-brand-soft text-brand-ink
                             grid place-items-center font-bold text-xs">{i + 1}</span>
            <span className="text-muted leading-snug">{step}</span>
          </li>
        ))}
      </ol>
      <pre className="bg-surface-2 border border-line rounded-xl p-4 text-xs overflow-x-auto mb-4">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...`}
      </pre>
      <p className="text-xs text-faint leading-relaxed">
        Full instructions, including how to make yourself an admin, are in README.md.
      </p>
    </main>
  )
}
