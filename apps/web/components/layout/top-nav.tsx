export function TopNav() {
  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">CRNA scheduling</p>
          <h1 className="text-xl font-semibold text-slate-950">Operations workspace</h1>
        </div>
        <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
          Local MVP
        </div>
      </div>
    </header>
  );
}
