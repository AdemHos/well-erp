import { withPermission } from "@/lib/rbac";
import { exportReport } from "@/lib/report-export";
export const GET = withPermission("reports.read", exportReport);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
