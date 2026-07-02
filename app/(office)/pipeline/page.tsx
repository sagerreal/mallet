"use client";

/**
 * app/(office)/pipeline/page.tsx
 * Thin route wrapper — all logic lives in features/pipeline/.
 */

import { PipelineView } from "@/features/pipeline";

export default function PipelinePage() {
  return <PipelineView />;
}
