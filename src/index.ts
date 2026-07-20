export {
  AuthBroker,
  type AuthStatus,
  type BrowserLoginOptions,
  type LoginOptions,
} from "./Auth/AuthBroker.js";
export type {
  AuthChallenge,
  AuthChallengeHandler,
} from "./Auth/AuthService.js";
export { loginWithBrowser } from "./Auth/BrowserAuth.js";
export {
  type CredentialStore,
  NativeCredentialStore,
} from "./Auth/CredentialStore.js";
export { type ProfileMetadata, ProfileStore } from "./Auth/ProfileStore.js";
export {
  CapabilityService,
  type ModuleAccess,
  type ModuleCapability,
} from "./Capabilities/CapabilityService.js";
export { IServApiError, IServAuthError } from "./Core/Errors.js";
export {
  type HtmlExtractedData,
  type HtmlItem,
  type HtmlList,
  type HtmlSection,
  type HtmlTable,
  isHtmlResponse,
  summarizeHtml,
} from "./Core/HtmlSummary.js";
export {
  assertSameOrigin,
  type NormalizedInstance,
  normalizeInstanceUrl,
} from "./Core/InstanceUrl.js";
export {
  IServAPI,
  IServAPI as IServClient,
  type ReadRouteRequest,
  type ReadRouteResult,
  type StoredSession,
} from "./Core/IServClient.js";
export { presentForDisplay } from "./Core/Present.js";
export { redactText, redactValue } from "./Core/Redaction.js";
export type { PatchMessageResult } from "./Email/EmailTypes.js";
export { startExplorerServer } from "./Explorer/ExplorerServer.js";
export { MessengerService } from "./Messenger/MessengerService.js";
export type {
  CreateDirectMessageResult,
  ListenOptions,
  Member,
  Message,
  MessageEvent,
  MessageListener,
  MessagesResult,
  MessengerContact,
  Room,
  RoomLastMessage,
  SendMessageResult,
  UserProfile,
} from "./Messenger/MessengerTypes.js";
export type { ModuleListResult } from "./Modules/ModulePageService.js";
export { ModulePageService } from "./Modules/ModulePageService.js";
export {
  ROUTES,
  RouteCatalog,
  type RouteDefinition,
  type RouteMethod,
  type RouteParameter,
  type RouteSearchOptions,
  type RouteSideEffect,
  type RouteStatus,
  routeCatalog,
} from "./Routes/RouteCatalog.js";
export { TimetableService } from "./Timetable/TimetableService.js";
export type {
  TimetableChange,
  TimetableDay,
  TimetableLesson,
  TimetableWeek,
} from "./Timetable/TimetableTypes.js";
export type {
  AlarmPreset,
  AlarmType,
  CreateEventOptions,
  CustomDateTimeAlarm,
  CustomIntervalAlarm,
  DeleteEventOptions,
  GetEmailsOptions,
  GetWebDavClientOptions,
  HolidayKind,
  HolidayPeriod,
  HolidayStatus,
  HolidaysOverview,
  IntervalType,
  IServDateTime,
  NotificationItem,
  ReadNotificationRef,
  Recurring,
  SendEmailOptions,
  SetUserInfoOptions,
  UserInfo,
  UserPublicInfo,
  WeekDay,
} from "./Types/index.js";
