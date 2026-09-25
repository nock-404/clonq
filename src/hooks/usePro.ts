import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** Whether Pro features may be used; null until the backend has answered. */
export function usePro(refresh: unknown = null): boolean | null {
  const [pro, setPro] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    api
      .licencePro()
      .then((value) => current && setPro(value))
      .catch(() => current && setPro(false));
    return () => {
      current = false;
    };
  }, [refresh]);
  return pro;
}
