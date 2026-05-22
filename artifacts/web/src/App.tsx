import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
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
import DashboardPage from "@/pages/DashboardPage";
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
import BroadcastsPage from "@/pages/BroadcastsPage";
import BroadcastEditorPage from "@/pages/BroadcastEditorPage";
import BroadcastDetailPage from "@/pages/BroadcastDetailPage";
import AutomationsPage from "@/pages/AutomationsPage";
import AutomationEditorPage from "@/pages/AutomationEditorPage";
import CatalogPage from "@/pages/CatalogPage";
import AdminPaymentsPage from "@/pages/AdminPaymentsPage";
import NotFound from "@/pages/not-found";

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

function DirectionManager() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const language = i18n.language?.startsWith("en") ? "en" : "ar";
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [i18n.language]);

  return null;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <Redirect to="/login" />;
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (user) return <Redirect to="/dashboard" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={() => <PublicRoute component={LoginPage} />} />
      <Route path="/register" component={() => <PublicRoute component={RegisterPage} />} />
      <Route path="/about" component={() => <PublicContentPage kind="about" />} />
      <Route path="/privacy" component={() => <PublicContentPage kind="privacy" />} />
      <Route path="/terms" component={() => <PublicContentPage kind="terms" />} />
      <Route path="/contact" component={() => <PublicContentPage kind="contact" />} />
      <Route path="/products" component={() => <PublicContentPage kind="products" />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/start" component={() => <ProtectedRoute component={BusinessSetupPage} />} />
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
      <Route path="/payments" component={() => <ProtectedRoute component={PaymentsPage} />} />
      <Route path="/debts" component={() => <ProtectedRoute component={DebtsPage} />} />
      <Route path="/catalog/posts" component={() => <ProtectedRoute component={() => <CatalogPage tab="posts" />} />} />
      <Route path="/catalog/ads" component={() => <ProtectedRoute component={() => <CatalogPage tab="ads" />} />} />
      <Route path="/catalog" component={() => <ProtectedRoute component={() => <CatalogPage tab="products" />} />} />
      <Route path="/knowledge" component={() => <ProtectedRoute component={KnowledgePage} />} />
      <Route path="/agents/:id" component={({ params }) => (
        <ProtectedRoute component={() => <AgentDetailPage agentId={params.id} />} />
      )} />
      <Route path="/agents" component={() => <ProtectedRoute component={AgentsPage} />} />
      <Route path="/audit-logs" component={() => <ProtectedRoute component={AuditLogsPage} />} />
      <Route path="/analytics" component={() => <ProtectedRoute component={AnalyticsPage} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={ReportsPage} />} />
      <Route path="/integrations/meta/select-channels" component={() => <ProtectedRoute component={MetaConnectChannelsPage} />} />
      <Route path="/integrations" component={() => <ProtectedRoute component={IntegrationsPage} />} />
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
      <Route path="/" component={() => <PublicRoute component={LandingPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <DirectionManager />
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </AuthProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </ErrorBoundary>
  );
}

export default App;
