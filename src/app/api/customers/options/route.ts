import { withPermission } from "@/lib/rbac";
import { customerOptions } from "@/lib/customer-read";
export const GET = withPermission("customers.manage", customerOptions);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
