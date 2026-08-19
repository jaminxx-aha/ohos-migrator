import Notification from '@system.notification';
import { ActionResult, ShowNotificationOptions } from '@system.notification';

// Scenario: notify the user of a new chat message and route them to the
// conversation page when the notification is clicked.

function buildClickAction(): ActionResult {
  const action: ActionResult = {
    bundleName: 'com.example.messaging',
    abilityName: 'MainAbility',
    uri: 'pages/conversation/detail',
  };
  console.info(`Routing to bundle=${action.bundleName}, ability=${action.abilityName}, uri=${action.uri}`);
  return action;
}

function showChatNotification(sender: string, preview: string): void {
  const options: ShowNotificationOptions = {
    contentTitle: `New message from ${sender}`,
    contentText: preview,
    clickAction: buildClickAction(),
  };
  console.info(`Showing notification: ${options.contentTitle} - ${options.contentText}`);
  const click = options.clickAction;
  if (click) {
    console.info('Click action attached; will launch the configured ability.');
  }
  Notification.show(options);
}

function run(): void {
  showChatNotification('Alice', 'Hey, are you free for lunch today?');
}

run();
