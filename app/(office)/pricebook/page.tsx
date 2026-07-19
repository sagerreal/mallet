"use client";

/** The Pricebook moved onto the Office page — this route redirects so old links keep working. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PricebookRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=pricebook");
  }, [router]);
  return null;
}
