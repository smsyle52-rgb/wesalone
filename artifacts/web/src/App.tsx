import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider, useTranslation } from "react-i18next";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Layout from "@/components/Layout";
import i18n from "@/i18n";
import LandingPage from "@/pages/LandingPage";
import PublicContentPage from "@/pages/PublicContentPages";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import DashboardPage from "@/pages/DashboardPage";
import OnboardingPage from "@/pages/OnboardingPage";
import AutomationHubPage from "@/pages/AutomationHubPage";
import MorePage from "@/pages/MorePage";
import InboxPage from "@/pages/InboxPage";
import TicketsPage from "@/pages/TicketsPage";
import TasksFollowupsPage from "@/pages/TasksFollowupsPage";
import ContactsPage from "@/pages/ContactsPage";
import OpportunitiesPage from "@/pages/OpportunitiesPage";
import OrdersPage from "@/pages/OrdersPage";
import PaymentsPage from "@/pages/PaymentsPage";
import SettingsPage from "@/pages/SettingsPage";
import AuditLogsPage from "@/pages/AuditLogsPage";
import ContactProfilePage from "@/pages/ContactProfilePage";
import DebtsPage from "@/pages/DebtsPage";
import KnowledgePage from "@/pages/KnowledgePage";
import AgentsPage from "@/pages/AgentsPage";
import AgentDetailPage from "@/pages/AgentDetailPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import ReportsPage from "@/pages/ReportsPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import MetaConnectChannelsPage from "@/pages/MetaConnectChannelsPage";
import BusinessSetupPage from "@/pages/BusinessSetupPage";
import TemplatesPage from "@/pages/TemplatesPage";
import TemplateEditorPage from "@/pages/TemplateEditorPage";
import WhatsAppBusinessProfilePage from "@/pages/WhatsAppBusinessProfilePage";
import BroadcastsPage from "@/pages/BroadcastsPage";
import BroadcastEditorPage from "@/pages/BroadcastEditorPage";
import BroadcastDetailPage from "@/pages/BroadcastDetailPage";
import AutomationsPage from "@/pages/AutomationsPage";
import AutomationEditorPage from "@/pages/AutomationEditorPage";
import AdminPaymentsPage from "@/pages/AdminPaymentsPage";
import AdminPointsPage from "@/pages/AdminPointsPage";
import PointsWalletPage from "@/pages/PointsWalletPage";
import ProductsPage from "@/pages/ProductsPage";
import NotFound from "@/pages/not-found";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { DirectionProvider } from "@workspace/ui/direction-provider";
import { TooltipProvider } from "@workspace/ui/tooltip";
import { Toaster } from "@workspace/ui/sonner";

const UiLabPage = import.meta.env.DEV
  ? lazy(() => import("@/pages/dev/UiLabPage"))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000 },
  },
});

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-white text-2xl font-bold mb-4 animate-pulse">خ</div>
        <p className="text-muted-foreground text-sm">جار التحميل...</p>
      </div>
    </div>
  );
}

function DirectionManager({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const direction = i18n.language?.startsWith("en") ? "ltr" : "rtl";

  useEffect(() => {
    const language = i18n.language?.startsWith("en") ? "en" : "ar";
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [direction, i18n.language]);

  return <DirectionProvider direction={direction}><TooltipProvider>{children}</TooltipProvider></DirectionProvider>;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, onboardingCompleted } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Redirect to="/login" />;
  if (!onboardingCompleted) return <Redirect to="/onboarding" />;
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function ProtectedRouteNoGate({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Redirect to="/login" />;
  return <Layout><Component /></Layout>;
}

function OnboardingRoute() {
  const { user, isLoading, onboardingCompleted } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Redirect to="/login" />;
  if (onboardingCompleted) return <Redirect to="/dashboard" />;
  return <OnboardingPage />;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading, onboardingCompleted } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (user) return <Redirect to={onboardingCompleted ? "/dashboard" : "/onboarding"} />;
  return <Component />;
}

function IntegrationsHubPage() {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">الملف التجاري في واتساب</h2>
          <p className="mt-1 text-xs text-muted-foreground">اعرض وعدّل بيانات النشاط المتزامنة مباشرة مع Meta.</p>
        </div>
        <Link href="/integrations/whatsapp/business-profile">
          <span className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            إدارة الملف التجاري
          </span>
        </Link>
      </div>
      <IntegrationsPage />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {UiLabPage ? (
        <Route
          path="/__ui-lab"
          component={() => (
            <Suspense fallback={<LoadingScreen />}>
              <UiLabPage />
            </Suspense>
          )}
        />
      ) : null}
      <Route path="/login" component={() => <PublicRoute component={LoginPage} />} />
      <Route path="/register" component={() => <PublicRoute component={RegisterPage} />} />
      <Route path="/forgot-password" component={() => <PublicRoute component={ForgotPasswordPage} />} />
      <Route path="/reset-password" component={() => <PublicRoute component={ResetPasswordPage} />} />
      <Route path="/verify-email" component={VerifyEmailPage} />
      <Route path="/about" component={() => <PublicContentPage kind="about" />} />
      <Route path="/privacy" component={() => <PublicContentPage kind="privacy" />} />
      <Route path="/data-deletion" component={() => <PublicContentPage kind="dataDeletion" />} />
      <Route path="/terms" component={() => <PublicContentPage kind="terms" />} />
      <Route path="/contact" component={() => <PublicContentPage kind="contact" />} />
      <Route path="/products" component={() => <PublicContentPage kind="products" />} />
      <Route path="/onboarding" component={OnboardingRoute} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/automation-hub" component={() => <ProtectedRoute component={AutomationHubPage} />} />
      <Route path="/more" component={() => <ProtectedRoute component={MorePage} />} />
      <Route path="/start" component={() => <ProtectedRouteNoGate component={BusinessSetupPage} />} />
      <Route path="/inbox" component={() => <ProtectedRoute component={InboxPage} />} />
      <Route path="/tickets" component={() => <ProtectedRoute component={TicketsPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksFollowupsPage} />} />
      <Route path="/followups" component={() => <Redirect to="/tasks?tab=followups" />} />
      <Route path="/contacts/:id" component={({ params }) => (
        <ProtectedRoute component={() => <ContactProfilePage contactId={params.id} />} />
      )} />
      <Route path="/contacts" component={() => <ProtectedRoute component={ContactsPage} />} />
      <Route path="/opportunities" component={() => <ProtectedRoute component={OpportunitiesPage} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={OrdersPage} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={ProductsPage} />} />
      <Route path="/payments" component={() => <ProtectedRoute component={PaymentsPage} />} />
      <Route path="/debts" component={() => <ProtectedRoute component={DebtsPage} />} />
      <Route path="/knowledge" component={() => <ProtectedRoute component={KnowledgePage} />} />
      <Route path="/agents/:id" component={({ params }) => (
        <ProtectedRoute component={() => <AgentDetailPage agentId={params.id} />} />
      )} />
      <Route path="/agents" component={() => <ProtectedRoute component={AgentsPage} />} />
      <Route path="/audit-logs" component={() => <ProtectedRoute component={AuditLogsPage} />} />
      <Route path="/analytics" component={() => <ProtectedRoute component={AnalyticsPage} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={ReportsPage} />} />
      <Route path="/integrations/meta/select-channels" component={() => <ProtectedRoute component={MetaConnectChannelsPage} />} />
      <Route path="/integrations/whatsapp/business-profile" component={() => <ProtectedRoute component={WhatsAppBusinessProfilePage} />} />
      <Route path="/integrations" component={() => <ProtectedRoute component={IntegrationsHubPage} />} />
      <Route path="/templates/new" component={() => <ProtectedRoute component={() => <TemplateEditorPage />} />} />
      <Route path="/templates/:id" component={({ params }) => (
        <ProtectedRoute component={() => <TemplateEditorPage templateId={params.id} />} />
      )} />
      <Route path="/templates" component={() => <ProtectedRoute component={TemplatesPage} />} />
      <Route path="/broadcasts/new" component={() => <ProtectedRoute component={BroadcastEditorPage} />} />
      <Route path="/broadcasts/:id" component={({ params }) => (
        <ProtectedRoute component={() => <BroadcastDetailPage broadcastId={params.id} />} />
      )} />
      <Route path="/broadcasts" component={() => <ProtectedRoute component={BroadcastsPage} />} />
      <Route path="/automations/new" component={() => <ProtectedRoute component={AutomationEditorPage} />} />
      <Route path="/automations/:id" component={({ params }) => (
        <ProtectedRoute component={() => <AutomationEditorPage automationId={params.id} />} />
      )} />
      <Route path="/automations" component={() => <ProtectedRoute component={AutomationsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/admin/payments" component={() => <ProtectedRoute component={AdminPaymentsPage} />} />
      <Route path="/admin/points" component={() => <ProtectedRoute component={AdminPointsPage} />} />
      <Route path="/points" component={() => <ProtectedRoute component={PointsWalletPage} />} />
      <Route path="/" component={() => <PublicRoute component={LandingPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <DirectionManager>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
                <Toaster />
                <PwaInstallBanner />
              </WouterRouter>
            </AuthProvider>
          </QueryClientProvider>
        </DirectionManager>
      </I18nextProvider>
    </ErrorBoundary>
  );
}

export default App;
