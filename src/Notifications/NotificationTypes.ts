export interface NotificationItem {
  id: number;
  type?: string;
  groupId?: string;
  groupTitle?: string;
  autoGrouping?: boolean;
  title: string;
  content?: string;
  trigger?: string;
  message?: string;
  groupMessage?: string;
  url?: string;
  icon?: string;
  date?: string;
  publishAt?: string | null;
  published?: boolean;
}

export interface IServDateTime {
  date: string;
  timezone_type: number;
  timezone: string;
}

export interface ReadNotificationRef {
  id: number;
  date: string;
  type: string;
}

export interface NotificationsData {
  lastEventId: number;
  lastId?: number;
  since: IServDateTime | null;
  count: number;
  notifications: NotificationItem[];
  read?: ReadNotificationRef[];
}

export type NavigationBadges = Record<string, number>;
