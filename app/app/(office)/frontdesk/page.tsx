"use client";

/** The Front Desk moved onto the Office page — this route redirects so old links keep working. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FrontDeskRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?tab=frontdesk");
  }, [router]);
  return null;
}
