// Public surface for the team-chat module — the only sanctioned import seam.
export { createTeamChatRouter } from "./api/team-chat-router";
export type { TeamThreadDTO, TeamMessageDTO } from "./api/team-chat-dto";
export { TeamThread, dmKeyFor, MAX_GROUP_TITLE, MAX_GROUP_MEMBERS } from "./domain/team-thread";
export type { ThreadKind } from "./domain/team-thread";
export {
  TeamMessage,
  CHAT_MEDIA_TYPES,
  CHAT_EXT_TO_MEDIA_TYPE,
  MAX_CHAT_BODY,
  MAX_CHAT_FILE_BYTES,
} from "./domain/team-message";
export type { ChatMediaType, ChatAttachment } from "./domain/team-message";
export type { TeamChatRepository, ThreadListRow } from "./domain/team-chat-repository";
export type { ChatFileGateway } from "./domain/chat-file-gateway";
export { StartDmUseCase } from "./app/start-dm";
export { CreateGroupUseCase } from "./app/create-group";
export { SendTeamMessageUseCase } from "./app/send-team-message";
export {
  ListTeamThreadsUseCase,
  ReadTeamThreadUseCase,
  MarkTeamThreadReadUseCase,
  THREAD_PAGE_LIMIT,
} from "./app/read-thread";
export { AddGroupMembersUseCase, LeaveTeamThreadUseCase } from "./app/manage-members";
export { DrizzleTeamChatRepository } from "./infra/drizzle-team-chat-repository";
export { SupabaseChatFileGateway, TEAM_FILES_BUCKET } from "./infra/supabase-chat-file-gateway";
