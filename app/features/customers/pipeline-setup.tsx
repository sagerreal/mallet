"use client";

import { PIPELINE_TEMPLATES, type PipelineTemplate } from "@/modules/customers/app/pipeline-stages";

/**
 * The Pipeline tab's first-run state — progressive disclosure's whole argument. A shop that never
 * opens this tab sees today's Customers page unchanged; nothing exists until someone standing
 * here decides it should. Templates are starting points, not prescriptions: every stage stays
 * renameable, movable and deletable afterwards.
 */
const TEMPLATE_COPY: Record<PipelineTemplate, { title: string; blurb: string }> = {
  sales: { title: "Sales follow-up", blurb: PIPELINE_TEMPLATES.sales.join(" → ") },
  insurance: { title: "Insurance claim", blurb: PIPELINE_TEMPLATES.insurance.join(" → ") },
  blank: { title: "Start blank", blurb: "Three empty stages — rename and add as you go." },
};

export function PipelineSetup({ onPick, seeding }: { onPick: (t: PipelineTemplate) => void; seeding: boolean }) {
  return (
    <div className="pipe-setup">
      <h3>Set up your pipeline</h3>
      <p>
        Stages are yours — name them, order them, drag customers between them. The List view stays
        exactly as it is either way.
      </p>
      <div className="pipe-tpls">
        {(Object.keys(TEMPLATE_COPY) as PipelineTemplate[]).map((t) => (
          <button key={t} type="button" className="pipe-tpl" disabled={seeding} onClick={() => onPick(t)}>
            <b>{TEMPLATE_COPY[t].title}</b>
            <span>{TEMPLATE_COPY[t].blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
