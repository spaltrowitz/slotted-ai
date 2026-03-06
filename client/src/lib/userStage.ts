export type UserStage =
  | 'no-calendar'
  | 'no-friends'
  | 'pending-invite'
  | 'first-hangout'
  | 'has-hangouts'
  | 'active-user';

export function getUserStage(data: {
  calendarConnected: boolean;
  friendCount: number;
  pendingInvitesCount: number;
  completedHangoutCount: number;
  upcomingHangoutCount: number;
}): UserStage {
  if (!data.calendarConnected) return 'no-calendar';
  if (data.friendCount === 0 && data.pendingInvitesCount > 0) return 'pending-invite';
  if (data.friendCount === 0) return 'no-friends';
  if (data.friendCount > 0 && data.completedHangoutCount === 0) return 'first-hangout';
  if (data.friendCount >= 3 && data.completedHangoutCount >= 2) return 'active-user';
  return 'has-hangouts';
}
