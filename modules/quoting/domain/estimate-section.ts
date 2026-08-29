/**
 * A named group of lines on an estimate — "Interior", "Exterior", "Site prep".
 *
 * A section carries NO money. It orders and titles lines and nothing else; every total still
 * derives from the lines themselves, so grouping can never change a price. That is why this is
 * a small value object beside the aggregate rather than another thing that computes.
 *
 * Lines point AT a section (`EstimateLine.sectionId`) rather than the section holding a list of
 * them: a line has exactly one section, and one direction of reference cannot disagree with
 * itself. A line with no section sits above the first group, which is what an ungrouped
 * estimate — the default — looks like.
 */
import type { EstimateSectionId, Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

/** Matches the column. A section name is a heading, not prose. */
export const MAX_SECTION_NAME_CHARS = 120;

export interface EstimateSectionProps {
  readonly id: EstimateSectionId;
  readonly name: string;
  /** Order among the estimate's sections. Whole and non-negative; ties are broken by name. */
  readonly position: number;
}

export class EstimateSection {
  private constructor(private readonly p: EstimateSectionProps) {}

  static create(props: EstimateSectionProps): Result<EstimateSection, ValidationError> {
    const name = props.name.trim();
    if (name.length === 0) {
      return err(validation("section name is required", "name"));
    }
    if (name.length > MAX_SECTION_NAME_CHARS) {
      return err(
        validation(`section name cannot exceed ${MAX_SECTION_NAME_CHARS} characters`, "name"),
      );
    }
    if (!Number.isInteger(props.position) || props.position < 0) {
      return err(validation("section position must be a whole number, 0 or more", "position"));
    }
    return ok(new EstimateSection({ ...props, name }));
  }

  get props(): EstimateSectionProps {
    return this.p;
  }

  get id(): EstimateSectionId {
    return this.p.id;
  }

  /** A renamed copy. Returns a Result because the new name is validated like the first one. */
  renamed(name: string): Result<EstimateSection, ValidationError> {
    return EstimateSection.create({ ...this.p, name });
  }

  /** A repositioned copy — used when a section is dragged, which never touches its name. */
  movedTo(position: number): Result<EstimateSection, ValidationError> {
    return EstimateSection.create({ ...this.p, position });
  }
}

/**
 * Sections in the order they render. Position leads; a name breaks a tie so two sections that
 * were saved at the same position still render in a stable order rather than an arbitrary one.
 */
export function orderSections(sections: readonly EstimateSection[]): readonly EstimateSection[] {
  return [...sections].sort(
    (a, b) => a.props.position - b.props.position || a.props.name.localeCompare(b.props.name),
  );
}
