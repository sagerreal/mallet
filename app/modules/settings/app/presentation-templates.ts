import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { PresentationPage, PresentationTemplate, SettingsRepository } from "../domain/settings-repository";

/**
 * The pages every new template starts with: the full v1 set, all on, bodies empty. Empty
 * bodies are the honest first-run state (no demo copy) — the customer page hides a non-cover
 * page whose body is empty, so a fresh template renders as just the estimate until the shop
 * writes its own words. Titles are functional defaults the shop can rename.
 */
export const DEFAULT_PRESENTATION_PAGES: readonly PresentationPage[] = [
  { key: "cover", on: true, title: "", body: "" },
  { key: "about", on: true, title: "About us", body: "" },
  { key: "reviews", on: true, title: "Reviews", body: "" },
  { key: "thanks", on: true, title: "Thank you", body: "" },
];

const MAX_NAME_CHARS = 80;

const validName = (name: string): Result<string, AppError> => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return err(validation("name is required", "name"));
  if (trimmed.length > MAX_NAME_CHARS) return err(validation("name is limited to 80 characters", "name"));
  return ok(trimmed);
};

// --- Create ---------------------------------------------------------------

export interface CreatePresentationTemplateCommand {
  readonly name: string;
  /** Omitted → DEFAULT_PRESENTATION_PAGES (the zod boundary bounds provided pages). */
  readonly pages?: readonly PresentationPage[];
}

export class CreatePresentationTemplateUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(
    cmd: CreatePresentationTemplateCommand,
    orgId: string,
  ): Promise<Result<PresentationTemplate, AppError>> {
    const name = validName(cmd.name);
    if (!name.ok) return name;
    const existing = await this.repo.listPresentationTemplates();
    const template = await this.repo.createPresentationTemplate({
      id: this.ids.newId(),
      orgId,
      name: name.value,
      pages: cmd.pages ?? DEFAULT_PRESENTATION_PAGES,
      position: existing.length,
    });
    logger.info({ orgId, id: template.id }, "settings.presentationTemplate.created");
    return ok(template);
  }
}

// --- Update ---------------------------------------------------------------

export interface UpdatePresentationTemplateCommand {
  readonly id: string;
  readonly name?: string;
  readonly pages?: readonly PresentationPage[];
}

export class UpdatePresentationTemplateUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: UpdatePresentationTemplateCommand,
    orgId: string,
  ): Promise<Result<PresentationTemplate, AppError>> {
    const existing = (await this.repo.listPresentationTemplates()).find((t) => t.id === cmd.id);
    if (!existing) return err(notFound("presentation template not found"));
    let name = existing.name;
    if (cmd.name !== undefined) {
      const valid = validName(cmd.name);
      if (!valid.ok) return valid;
      name = valid.value;
    }
    const next: PresentationTemplate = {
      ...existing,
      name,
      pages: cmd.pages ?? existing.pages,
    };
    const affected = await this.repo.savePresentationTemplate(next, this.clock.now());
    if (affected === 0) return err(notFound("presentation template not found"));
    logger.info({ orgId, id: next.id }, "settings.presentationTemplate.updated");
    return ok(next);
  }
}

// --- Remove ---------------------------------------------------------------

export class RemovePresentationTemplateUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: { readonly id: string }, orgId: string): Promise<Result<{ ok: true }, AppError>> {
    const affected = await this.repo.archivePresentationTemplate(cmd.id, this.clock.now());
    if (affected === 0) return err(notFound("presentation template not found"));
    logger.info({ orgId, id: cmd.id }, "settings.presentationTemplate.archived");
    return ok({ ok: true });
  }
}
