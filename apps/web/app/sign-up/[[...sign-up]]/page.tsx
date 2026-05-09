import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md">
        <div className="mb-6">
          <p className="text-sm font-medium text-slate-500">Bespoke Anesthesia</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">
            Operations workspace
          </h1>
        </div>
        <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" />
      </section>
    </main>
  );
}
