import type { ReactNode } from "react";
import styles from "./FinanceWorkspace.module.css";

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <div data-finance-workspace className={styles.workspace}>{children}</div>;
}
