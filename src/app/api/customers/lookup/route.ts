import { withPermission } from "@/lib/rbac";
import { lookupCustomers } from "@/lib/customer-read";
export const GET = withPermission("customers.lookup", lookupCustomers);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
