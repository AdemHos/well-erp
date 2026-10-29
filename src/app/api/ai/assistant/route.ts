import { NextResponse } from "next/server";
import { withPermission } from "@/lib/rbac";
import { getCurrentMembership } from "@/lib/current-membership";
import { boundedJson } from "@/lib/http-security";
import { consumeRateLimit } from "@/lib/rate-limit";
import { dashboardPeriod, loadDashboard } from "@/lib/dashboard-data";
import { criticalStockAlerts } from "@/lib/stock-alerts";
import { askAssistant, AssistantError, assistantQuestion } from "@/lib/ai-assistant";

export const runtime = "nodejs";
export const maxDuration = 45;

export const POST = withPermission("finance.manage", async (request: Request) => {
  const actor = (await getCurrentMembership({ required: true }))!;
  try {
    const question = assistantQuestion(await boundedJson(request, 8192));
    consumeRateLimit("ai-user", `${actor.organizationId}:${actor.profileId ?? actor.userId}`, 10, 60000);
    consumeRateLimit("ai-organization", actor.organizationId, 100, 86400000);
    const dashboard = await loadDashboard(actor);
    if (!dashboard.branchId) return NextResponse.json({ error: "Önce erişebildiğiniz bir şube oluşturun veya seçin." }, { status: 400 });
    const stocks = await criticalStockAlerts();
    const generatedAt = new Date().toISOString();
    // Explicit allowlist: no user/customer details, order numbers or credentials.
    const context = {
      date: dashboardPeriod().day, timezone: "Europe/Istanbul", currency: "TRY", generatedAt,
      sales: { total: dashboard.total, count: dashboard.count, average: dashboard.average, changes: dashboard.changes, last30Days: dashboard.charts.month },
      criticalStock: { available: stocks.enabled, total: stocks.enabled ? stocks.total : null,
        firstFive: stocks.rows.map(({ name, quantity, criticalLevel, unit }) => ({ name: name.slice(0, 160), quantity, criticalLevel, unit })) },
    };
    const answer = await askAssistant(question, context);
    return NextResponse.json({ answer, generatedAt, branchId: dashboard.branchId, date: context.date }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssistantError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
