import notification from '@ohos.notification';
import notificationManager from '@ohos.notificationManager';

// Scenario: register and inspect notification slots for a chat application.
async function manageSlots(): Promise<void> {
  try {
    await notification.addSlot(notification.SlotType.SOCIAL_COMMUNICATION);
    await notification.addSlot(notification.SlotType.SERVICE_INFORMATION);
    await notification.addSlot(notification.SlotType.CONTENT_INFORMATION);
    await notification.addSlot(notification.SlotType.OTHER_TYPES);
    await notification.addSlot(notification.SlotType.UNKNOWN_TYPE);

    const socialSlot = await notification.getSlot(notification.SlotType.SOCIAL_COMMUNICATION);
    console.info('social slot', socialSlot);
    const serviceSlot = await notification.getSlot(notification.SlotType.SERVICE_INFORMATION);
    console.info('service slot', serviceSlot);

    const allSlots = await notification.getSlots();
    console.info('slot count', allSlots.length);

    // Map each configured importance level to a descriptive bucket name.
    const levels: Map<number, string> = new Map<number, string>();
    levels.set(notification.SlotLevel.LEVEL_NONE, 'silent');
    levels.set(notification.SlotLevel.LEVEL_MIN, 'minimal');
    levels.set(notification.SlotLevel.LEVEL_LOW, 'low');
    levels.set(notification.SlotLevel.LEVEL_DEFAULT, 'default');
    levels.set(notification.SlotLevel.LEVEL_HIGH, 'high');
    const defaultLevel: notification.SlotLevel = notification.SlotLevel.LEVEL_DEFAULT;
    const highLevel: notification.SlotLevel = notification.SlotLevel.LEVEL_HIGH;
    console.info('default bucket', levels.get(defaultLevel), 'high bucket', levels.get(highLevel));

    await notification.removeSlot(notification.SlotType.OTHER_TYPES);
    await notification.removeAllSlots();
  } catch (e) {
    console.error('manageSlots failed', e);
  }
}

// Scenario: publish a basic text notification for an incoming message, then tear it down.
async function publishAndCancel(): Promise<void> {
  const bundleOption: notification.BundleOption = { bundle: 'com.example.chatapp', uid: 1002003 };
  const bundleName: string = bundleOption.bundle;
  const ownerUid: number | undefined = bundleOption.uid;
  console.info('publishing on behalf of', bundleName, ownerUid);

  const basicNormal: notificationManager.NotificationBasicContent = {
    title: 'New message from Alice',
    text: 'Hey, are you free for lunch today?',
    additionalText: 'Chat · just now'
  };
  const basicContent: notificationManager.NotificationContent = {
    contentType: notification.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
    normal: basicNormal
  };
  const request: notificationManager.NotificationRequest = {
    id: 1001,
    label: 'IM_MESSAGE',
    content: basicContent,
    slotType: notification.SlotType.SOCIAL_COMMUNICATION
  };

  try {
    await notification.publish(request);
    const cancelTarget: number = request.id !== undefined ? request.id : 0;
    await notification.cancel(cancelTarget);
    await notification.cancelGroup('IM_MESSAGE');
    await notification.cancelAll();
  } catch (e) {
    console.error('publishAndCancel failed', e);
  }
}

// Scenario: publish long-text, multiline, picture and conversation notifications for a media feed.
async function publishFeedNotifications(): Promise<void> {
  const key: notification.NotificationKey = { id: 2048, label: 'FEED' };
  const feedId: number = key.id;
  const feedLabel: string = key.label !== undefined ? key.label : '';
  console.info('feed key', feedId, feedLabel);

  const longTextBody: notificationManager.NotificationLongTextContent = {
    title: 'Daily digest',
    text: 'Today we are rolling out an improved recommendation engine.',
    longText: 'Today we are rolling out an improved recommendation engine that surfaces stories from the people you follow most. Read on for details about how ranking works and how to tune your feed.',
    briefText: 'Daily digest',
    expandedTitle: 'Daily digest — full details'
  };
  const longContent: notificationManager.NotificationContent = {
    contentType: notification.ContentType.NOTIFICATION_CONTENT_LONG_TEXT,
    longText: longTextBody
  };

  const multiLineBody: notificationManager.NotificationMultiLineContent = {
    title: 'Weekly highlights',
    text: 'Top stories of the week',
    briefText: 'Weekly highlights',
    longTitle: 'Weekly highlights for you',
    lines: [
      'Alice published a new photo album',
      'Bob started a live stream',
      'Carol shared a recipe'
    ]
  };
  const multiLineContent: notificationManager.NotificationContent = {
    contentType: notification.ContentType.NOTIFICATION_CONTENT_MULTILINE,
    multiLine: multiLineBody
  };

  const pictureContent: notificationManager.NotificationContent = {
    contentType: notification.ContentType.NOTIFICATION_CONTENT_PICTURE
  };

  const conversationContent: notificationManager.NotificationContent = {
    contentType: notification.ContentType.NOTIFICATION_CONTENT_CONVERSATION
  };

  const r1: notificationManager.NotificationRequest = { id: feedId, label: feedLabel, content: longContent };
  const r2: notificationManager.NotificationRequest = { id: feedId + 1, label: feedLabel, content: multiLineContent };
  const r3: notificationManager.NotificationRequest = { id: feedId + 2, label: feedLabel, content: pictureContent };
  const r4: notificationManager.NotificationRequest = { id: feedId + 3, label: feedLabel, content: conversationContent };
  const requests: Array<notificationManager.NotificationRequest> = [r1, r2, r3, r4];

  try {
    for (const r of requests) {
      await notification.publish(r);
    }
  } catch (e) {
    console.error('publishFeedNotifications failed', e);
  }
}

// Scenario: inspect active notifications, distributed capability and template support.
async function inspectActiveNotifications(): Promise<void> {
  try {
    const enabled: boolean = await notification.isDistributedEnabled();
    if (!enabled) {
      console.info('distributed notification is disabled');
    }

    const supportsTemplate: boolean = await notification.isSupportTemplate('download-complete');
    await notification.requestEnableNotification();
    console.info('template supported', supportsTemplate, 'notification enabled');

    const activeCount: number = await notification.getActiveNotificationCount();
    const activeList = await notification.getActiveNotifications();
    console.info('active notifications', activeCount, activeList.length);
  } catch (e) {
    console.error('inspectActiveNotifications failed', e);
  }
}

async function run(): Promise<void> {
  await manageSlots();
  await publishAndCancel();
  await publishFeedNotifications();
  await inspectActiveNotifications();
}

run();
