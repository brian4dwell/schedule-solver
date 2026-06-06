import { TopNav } from "@/components/layout/top-nav";

type AppShellProps = {
  children: React.ReactNode;
  primaryNavigationIsVisible?: boolean;
  topBarContent?: React.ReactNode;
  workspaceTitle?: string;
};

export function AppShell({
  children,
  primaryNavigationIsVisible = true,
  topBarContent,
  workspaceTitle = "Operations workspace",
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <TopNav
        primaryNavigationIsVisible={primaryNavigationIsVisible}
        secondaryNavigation={topBarContent}
        workspaceTitle={workspaceTitle}
      />
      <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
