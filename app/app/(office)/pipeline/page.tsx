"use client";

/** The sales board was superseded by the work board on the Office page — this route redirects so old links keep working. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PipelineRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
