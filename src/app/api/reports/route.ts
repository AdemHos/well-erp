import { withPermission } from "@/lib/rbac";
import { getReport } from "@/lib/report-service";
export const GET = withPermission("reports.read", getReport);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
