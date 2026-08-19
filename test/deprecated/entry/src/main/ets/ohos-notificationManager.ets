import notificationManager from '@ohos.notificationManager';

// Scenario: a chat app requests notification permission, registers a social-communication
// slot, and publishes an incoming-message notification. The deprecated legacy fields are
// read once for compatibility diagnostics before publishing.

async function ensureNotificationEnabled(): Promise<void> {
  return new Promise<void>((resolve) => {
    notificationManager.requestEnableNotification((err) => {
      if (err) {
        console.error('requestEnableNotification failed', JSON.stringify(err));
        resolve();
        return;
      }
      resolve();
    });
  });
}

async function publishIncomingChatMessage(): Promise<void> {
  const content: notificationManager.NotificationContent = {
    notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
    normal: {
      title: 'New message from Alice',
      text: 'Hey, are you free tonight?',
      additionalText: 'Chat',
    },
  };

  const slot: notificationManager.NotificationSlot = {
    notificationType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
    notificationLevel: notificationManager.SlotLevel.LEVEL_HIGH,
    desc: 'Social communication slot for chat messages',
    badgeFlag: true,
    bypassDnd: false,
  };

  const request: notificationManager.NotificationRequest = {
    id: 20250817,
    notificationSlotType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
    content,
  };

  // Legacy compatibility: read deprecated fields once for diagnostics.
  const legacyContentType = content.contentType;
  const legacyRequestSlotType = request.slotType;
  const legacySlotType = slot.type;
  const legacySlotLevel = slot.level;
  console.info(
    'legacy notification fields',
    legacyContentType,
    legacyRequestSlotType,
    legacySlotType,
    legacySlotLevel,
  );

  try {
    await notificationManager.addSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
    await notificationManager.publish(request);
  } catch (e) {
    console.error('publish incoming chat notification failed', e);
  }
}

async function run(): Promise<void> {
  await ensureNotificationEnabled();
  await publishIncomingChatMessage();
}

run();
