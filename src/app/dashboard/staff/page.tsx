import { requirePagePermission } from "@/lib/rbac";
import LocalStaffManager from "@/components/staff/LocalStaffManager";
import StaffManager from "@/components/staff/StaffManager";
export default async function StaffPage() {
  await requirePagePermission("staff.read");
  return <div className="space-y-8"><LocalStaffManager /><details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">Mevcut hesap üyelikleri ve işlem kayıtları</summary><div className="mt-5"><StaffManager /></div></details></div>;
}
