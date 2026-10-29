import { withPermission } from "@/lib/rbac";
import { createCustomer } from "@/lib/customer-service";
import { listCustomers } from "@/lib/customer-read";
export const GET = withPermission("customers.read", listCustomers);
export const POST = withPermission("customers.manage", createCustomer);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
