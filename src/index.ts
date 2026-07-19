export {
  AuthBroker,
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
export { IServApiError, IServAuthError } from "./Core/Errors.js";
export {
  assertSameOrigin,
  type NormalizedInstance,
  normalizeInstanceUrl,
} from "./Core/InstanceUrl.js";
export {
  IServAPI,
  IServAPI as IServClient,
  type StoredSession,
} from "./Core/IServClient.js";
export { redactText, redactValue } from "./Core/Redaction.js";
export type { PatchMessageResult } from "./Email/EmailTypes.js";
export { MessengerService } from "./Messenger/MessengerService.js";
export type {
  CreateDirectMessageResult,
  ListenOptions,
  Member,
  Message,
  MessageEvent,
  MessageListener,
  MessagesResult,
  Room,
  RoomLastMessage,
  SendMessageResult,
  UserProfile,
} from "./Messenger/MessengerTypes.js";
export {
  ROUTES,
  RouteCatalog,
  type RouteDefinition,
  type RouteMethod,
  type RouteParameter,
  type RouteSideEffect,
  type RouteStatus,
  routeCatalog,
} from "./Routes/RouteCatalog.js";
export type {
  AlarmPreset,
  AlarmType,
  CreateEventOptions,
  CustomDateTimeAlarm,
  CustomIntervalAlarm,
  DeleteEventOptions,
  GetEmailsOptions,
  GetWebDavClientOptions,
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
