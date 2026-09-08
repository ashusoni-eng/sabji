import { Component } from 'react'

/**
 * Catches render crashes so a customer sees a way out instead of a white screen.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    // Wire an error tracker (Sentry, etc.) here when you add one.
    console.error('Unhandled error:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <span className="material-symbols-outlined text-[52px] text-danger mb-3">error</span>
          <h1 className="font-headline font-extrabold text-xl mb-2">Something broke</h1>
          <p className="text-muted mb-6 max-w-xs mx-auto">
            Sorry — the app hit an error. Reloading usually fixes it.
          </p>
          <button onClick={() => window.location.assign('/')}
                  className="bg-brand text-on-brand font-bold rounded-xl px-6 min-h-[48px]">
            Reload the app
          </button>
        </div>
      </main>
    )
  }
}
