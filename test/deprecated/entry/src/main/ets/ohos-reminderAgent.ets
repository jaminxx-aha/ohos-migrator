import reminderAgent from '@ohos.reminderAgent';

// Capture the deprecated enum namespaces via their member accesses below
// (ActionButtonType / ReminderType) so each enum symbol is touched exactly once.

// Scenario 1 — publish a calendar-based meeting reminder with action buttons and want-agent redirects.
async function publishCalendarMeetingReminder(): Promise<number> {
  const meetingTime: reminderAgent.LocalDateTime = {
    year: 2026, month: 8, day: 17, hour: 14, minute: 30, second: 0,
  };
  console.log('meeting at',
    meetingTime.year, meetingTime.month, meetingTime.day,
    meetingTime.hour, meetingTime.minute, meetingTime.second);

  const tapTarget: reminderAgent.WantAgent = {
    pkgName: 'com.example.reminders', abilityName: 'MeetingAbility',
  };
  console.log('tap target', tapTarget.pkgName, tapTarget.abilityName);

  const fullScreenTarget: reminderAgent.MaxScreenWantAgent = {
    pkgName: 'com.example.reminders', abilityName: 'MeetingMaxScreenAbility',
  };
  console.log('max-screen target', fullScreenTarget.pkgName, fullScreenTarget.abilityName);

  const dismissButton: reminderAgent.ActionButton = {
    title: 'Dismiss', type: reminderAgent.ActionButtonType.ACTION_BUTTON_TYPE_CLOSE,
  };
  console.log('button', dismissButton.title, dismissButton.type);

  const calendarReminder: reminderAgent.ReminderRequestCalendar = {
    reminderType: reminderAgent.ReminderType.REMINDER_TYPE_CALENDAR,
    dateTime: meetingTime,
    repeatMonths: [0],
    repeatDays: [1, 3, 5],
    title: 'Team Sync',
    content: 'Weekly team sync meeting',
    expiredContent: 'Team sync has started',
    snoozeContent: 'Snoozing team sync',
    snoozeTimes: 2,
    timeInterval: 300,
    ringDuration: 5,
    notificationId: 1001,
    actionButton: [dismissButton, { title: 'Snooze', type: reminderAgent.ActionButtonType.ACTION_BUTTON_TYPE_SNOOZE }],
    wantAgent: tapTarget,
    maxScreenWantAgent: fullScreenTarget,
  };
  console.log('calendar fields',
    calendarReminder.dateTime, calendarReminder.repeatMonths, calendarReminder.repeatDays);

  // Read the shared ReminderRequest fields via a ReminderRequest-typed view.
  const reminder: reminderAgent.ReminderRequest = calendarReminder;
  console.log('reminder base',
    reminder.reminderType, reminder.title, reminder.content, reminder.expiredContent,
    reminder.snoozeContent, reminder.snoozeTimes, reminder.timeInterval, reminder.ringDuration,
    reminder.notificationId, reminder.slotType, reminder.actionButton,
    reminder.wantAgent, reminder.maxScreenWantAgent);

  try {
    const reminderId = await reminderAgent.publishReminder(reminder);
    console.log('published calendar reminder id=', reminderId);
    return reminderId;
  } catch (e) {
    console.error('publishCalendarMeetingReminder failed', e);
    return -1;
  }
}

// Scenario 2 — prepare (but do not publish) a daily weekday alarm draft.
function prepareAlarmDraft(): void {
  const alarm: reminderAgent.ReminderRequestAlarm = {
    reminderType: reminderAgent.ReminderType.REMINDER_TYPE_ALARM,
    hour: 9,
    minute: 30,
    daysOfWeek: [2, 3, 4, 5, 6],
    title: 'Stand-up',
    content: 'Daily stand-up meeting',
  };
  console.log('alarm draft', alarm.hour, alarm.minute, alarm.daysOfWeek);
}

// Scenario 3 — prepare (but do not publish) a countdown timer draft.
function prepareTimerDraft(): void {
  const timer: reminderAgent.ReminderRequestTimer = {
    reminderType: reminderAgent.ReminderType.REMINDER_TYPE_TIMER,
    triggerTimeInSeconds: 1500,
    title: 'Pizza timer',
    content: 'Your pizza is ready',
  };
  console.log('timer draft', timer.triggerTimeInSeconds);
}

// Scenario 4 — lifecycle: list valid reminders, cancel one, cancel all, and note slot management APIs.
async function manageReminders(reminderId: number): Promise<void> {
  try {
    const valid = await reminderAgent.getValidReminders();
    console.log('valid reminders count=', valid.length);
  } catch (e) {
    console.error('getValidReminders failed', e);
  }

  if (reminderId >= 0) {
    try {
      await reminderAgent.cancelReminder(reminderId);
      console.log('cancelled reminder id=', reminderId);
    } catch (e) {
      console.error('cancelReminder failed', e);
    }
  }

  try {
    await reminderAgent.cancelAllReminders();
    console.log('cancelled all reminders');
  } catch (e) {
    console.error('cancelAllReminders failed', e);
  }

  // Slot management is available on this deprecated module; reference the operations for logging.
  console.log('slot ops', reminderAgent.addNotificationSlot, reminderAgent.removeNotificationSlot);
}

async function run(): Promise<void> {
  const reminderId = await publishCalendarMeetingReminder();
  prepareAlarmDraft();
  prepareTimerDraft();
  await manageReminders(reminderId);
}

run();
