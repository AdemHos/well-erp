import { withPermission } from "@/lib/rbac";
import { saveSupplierProduct } from "@/lib/supplier-products";
import { removeSupplierProduct } from "@/lib/supplier-products";
export const PATCH = withPermission("suppliers.manage", saveSupplierProduct);
export const DELETE = withPermission("suppliers.manage", removeSupplierProduct);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
