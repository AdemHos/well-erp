import { withPermission } from "@/lib/rbac";
import { updateCustomer } from "@/lib/customer-service";
import { getCustomer } from "@/lib/customer-read";
export const GET = withPermission("customers.read", getCustomer);
export const PATCH = withPermission("customers.manage", updateCustomer);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
