import { withPermission } from "@/lib/rbac";
import { listSupplierProducts } from "@/lib/supplier-read";
import { saveSupplierProduct } from "@/lib/supplier-products";
export const GET = withPermission("suppliers.read", listSupplierProducts);
export const POST = withPermission("suppliers.manage", saveSupplierProduct);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
